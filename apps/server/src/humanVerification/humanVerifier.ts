/** Verifies Turnstile tokens with replay, action, hostname, freshness, timeout, and response bounds. */
import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  isErrorInstance,
  type OperationalErrorDiagnostic,
} from '../operations/errorDiagnostics.js';
import {
  diagnosePrivateProviderText,
  diagnoseProviderExtraFields,
  diagnoseProviderHttp,
  diagnoseProviderOperationalError,
  privatizeProviderTextDiagnostic,
  ProviderBodyReadError,
  readProviderResponseBody,
  type ProviderHttpDiagnostic,
  type ProviderTextDiagnostic,
  type ProviderValueEntryDiagnostic,
} from '../operations/providerDiagnostics.js';

export type HumanVerificationAction = 'password-reset' | 'registration';
export type HumanVerificationResult =
  | { verified: true }
  | {
      verified: false;
      reason:
        | 'duplicate'
        | 'invalid'
        | 'malformed'
        | 'mismatch'
        | 'missing'
        | 'stale'
        | 'unavailable';
    };

export interface HumanVerifier {
  verify(input: {
    action: HumanVerificationAction;
    token: string;
  }): Promise<HumanVerificationResult>;
}

export interface HumanVerificationFailureDiagnostic {
  action: HumanVerificationAction;
  attempt: 1 | 2 | null;
  category:
    | 'action-mismatch'
    | 'hostname-mismatch'
    | 'http'
    | 'invalid-challenge-time'
    | 'malformed-json'
    | 'provider-declined'
    | 'response-schema'
    | 'response-too-large'
    | 'transport';
  httpStatusCode: number | null;
  operationalError: OperationalErrorDiagnostic | null;
  providerActionDiagnostic: ProviderTextDiagnostic | null;
  providerChallengeAgeMilliseconds: number | null;
  providerChallengeTimestamp: string | null;
  providerErrorCodeDiagnostics: ProviderTextDiagnostic[];
  providerErrorCodes: string[];
  providerExtraFields: ProviderValueEntryDiagnostic[];
  providerFieldNames: string[];
  providerFieldsComplete: boolean | null;
  providerFieldsObserved: number;
  providerFieldsOmitted: number;
  providerHostnameDiagnostic: ProviderTextDiagnostic | null;
  providerHttp: ProviderHttpDiagnostic | null;
  providerResponseDiagnostic: ProviderTextDiagnostic | null;
  providerResponseFingerprint: string | null;
  providerResponseLength: number | null;
  providerResponseTruncated: boolean | null;
  providerSchemaIssues: Array<{ issueCode: string; path: string }>;
  providerSchemaIssuesComplete: boolean | null;
  providerSchemaIssuesObserved: number;
  providerSchemaIssuesOmitted: number;
  providerSuccess: boolean | null;
  request: {
    endpointHost: 'challenges.cloudflare.com';
    expectedAction: HumanVerificationAction;
    expectedHostnameDiagnostic: ProviderTextDiagnostic;
    httpMethod: 'POST';
    idempotencyKey: string;
    maximumAttempts: 2;
    remoteIpIncluded: false;
    timeoutMilliseconds: number;
    tokenDiagnostic: ProviderTextDiagnostic;
  } | null;
  providerActionMatchesExpected: boolean | null;
  providerHostnameMatchesExpected: boolean | null;
}

const responseSchema = z.object({
  'error-codes': z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u))
    .max(16)
    .optional(),
  action: z.string().optional(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  success: z.boolean(),
});

const TOKEN_MAX_LENGTH = 2_048;
const TOKEN_RETENTION_MS = 10 * 60_000;
const MAX_TOKEN_RECORDS = 4_096;
const MAX_RESPONSE_BYTES = 16 * 1_024;
const CHALLENGE_MAX_AGE_MS = 5 * 60_000;
const CHALLENGE_FUTURE_TOLERANCE_MS = 30_000;
const MAX_PROVIDER_FIELDS = 64;
const MAX_SCHEMA_ISSUES = 32;
const KNOWN_TURNSTILE_FIELDS = new Set([
  'action',
  'challenge_ts',
  'error-codes',
  'hostname',
  'success',
]);

interface TurnstileRequestDiagnostic {
  endpointHost: 'challenges.cloudflare.com';
  expectedAction: HumanVerificationAction;
  expectedHostnameDiagnostic: ProviderTextDiagnostic;
  httpMethod: 'POST';
  idempotencyKey: string;
  maximumAttempts: 2;
  remoteIpIncluded: false;
  timeoutMilliseconds: number;
  tokenDiagnostic: ProviderTextDiagnostic;
}

interface TurnstileResponseEvidence {
  http: ProviderHttpDiagnostic;
  request: TurnstileRequestDiagnostic;
  response: ProviderTextDiagnostic;
  /** Internal parsed value; always installed as non-enumerable. */
  value?: unknown;
}

interface TurnstileStructuredDiagnosticInput {
  evidence?: TurnstileResponseEvidence;
  request?: TurnstileRequestDiagnostic;
  fields?: ReturnType<typeof providerFieldEvidence>;
  httpStatusCode?: number;
  providerAction?: string;
  providerErrorCodes?: string[];
  providerExtraFields?: ProviderValueEntryDiagnostic[];
  providerHostname?: string;
  schemaIssues?: ReturnType<typeof providerSchemaIssues>;
  success?: boolean;
}

class TurnstileDiagnosticError extends Error {
  constructor(
    message: string,
    readonly category: HumanVerificationFailureDiagnostic['category'],
    readonly httpStatusCode: number | null,
    readonly requestDiagnostic: TurnstileRequestDiagnostic,
    readonly responseEvidence: TurnstileResponseEvidence | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TurnstileDiagnosticError';
  }
}

class TurnstileNetworkError extends TurnstileDiagnosticError {
  constructor(
    cause: unknown,
    request: TurnstileRequestDiagnostic,
    evidence: TurnstileResponseEvidence | null = null,
  ) {
    super(
      'Turnstile network request failed',
      'transport',
      evidence?.http.statusCode ?? null,
      request,
      evidence,
      { cause },
    );
    this.name = 'TurnstileNetworkError';
  }
}

class TurnstileMalformedResponseError extends TurnstileDiagnosticError {}
class TurnstileServiceError extends TurnstileDiagnosticError {}

function providerFieldEvidence(value: unknown): {
  complete: boolean | null;
  names: string[];
  observed: number;
  omitted: number;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { complete: null, names: [], observed: 0, omitted: 0 };
  }
  try {
    const all = Object.keys(value);
    const retained = all.slice(0, MAX_PROVIDER_FIELDS);
    return {
      complete: all.length <= MAX_PROVIDER_FIELDS,
      names: retained.map((name) =>
        /^[A-Za-z0-9_-]{1,128}$/u.test(name)
          ? name
          : `[field:${createHash('sha256').update(name).digest('hex')}]`,
      ),
      observed: all.length,
      omitted: Math.max(0, all.length - retained.length),
    };
  } catch {
    return { complete: false, names: [], observed: 0, omitted: 0 };
  }
}

function providerSchemaIssues(error: z.ZodError): {
  complete: boolean;
  issues: Array<{ issueCode: string; path: string }>;
  observed: number;
  omitted: number;
} {
  const retained = error.issues.slice(0, MAX_SCHEMA_ISSUES);
  return {
    complete: error.issues.length <= MAX_SCHEMA_ISSUES,
    issues: retained.map((issue) => ({
      issueCode: issue.code,
      path: issue.path
        .map((segment) => {
          const value = String(segment);
          return /^[A-Za-z0-9_-]{1,128}$/u.test(value)
            ? value
            : `[segment:${createHash('sha256').update(value).digest('hex')}]`;
        })
        .join('.'),
    })),
    observed: error.issues.length,
    omitted: Math.max(0, error.issues.length - retained.length),
  };
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function requestSiteverify(input: {
  fetchImplementation: typeof fetch;
  requestDiagnostic: TurnstileRequestDiagnostic;
  secret: string;
  token: string;
}): Promise<{ evidence: TurnstileResponseEvidence; value: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    input.requestDiagnostic.timeoutMilliseconds,
  );
  timer.unref();
  try {
    const body = new URLSearchParams({
      idempotency_key: input.requestDiagnostic.idempotencyKey,
      response: input.token,
      secret: input.secret,
    });
    let response: Response;
    try {
      response = await input.fetchImplementation(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          body,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          method: 'POST',
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new TurnstileNetworkError(error, input.requestDiagnostic);
    }
    const http = diagnoseProviderHttp(response);
    let read: Awaited<ReturnType<typeof readProviderResponseBody>>;
    try {
      read = await readProviderResponseBody(response, MAX_RESPONSE_BYTES);
    } catch (error) {
      if (isErrorInstance(error, ProviderBodyReadError)) {
        throw new TurnstileNetworkError(error, input.requestDiagnostic, {
          http,
          request: input.requestDiagnostic,
          response: privatizeProviderTextDiagnostic(
            error.diagnostic,
            'Private Turnstile response body omitted',
          ),
        });
      }
      throw new TurnstileNetworkError(error, input.requestDiagnostic, null);
    }
    const responseDiagnostic = privatizeProviderTextDiagnostic(
      read.diagnostic,
      'Private Turnstile response body omitted',
    );
    const evidence = {
      http,
      request: input.requestDiagnostic,
      response: responseDiagnostic,
    };
    if (read.diagnostic.inspectionTruncated) {
      throw new TurnstileMalformedResponseError(
        'Turnstile response exceeded limit',
        'response-too-large',
        response.status,
        input.requestDiagnostic,
        evidence,
      );
    }
    if (!read.diagnostic.utf8Valid) {
      throw new TurnstileMalformedResponseError(
        'Turnstile response was not valid UTF-8',
        'malformed-json',
        response.status,
        input.requestDiagnostic,
        evidence,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(read.text) as unknown;
    } catch (error) {
      if (!response.ok) {
        throw new TurnstileServiceError(
          'Turnstile service rejected the request with a non-JSON response',
          'http',
          response.status,
          input.requestDiagnostic,
          evidence,
          { cause: error },
        );
      }
      throw new TurnstileMalformedResponseError(
        'Turnstile response was not JSON',
        'malformed-json',
        response.status,
        input.requestDiagnostic,
        evidence,
        { cause: error },
      );
    }
    const structuredEvidence: TurnstileResponseEvidence = { ...evidence };
    Object.defineProperty(structuredEvidence, 'value', {
      configurable: false,
      enumerable: false,
      value,
      writable: false,
    });
    if (!response.ok) {
      throw new TurnstileServiceError(
        'Turnstile service rejected the request',
        'http',
        response.status,
        input.requestDiagnostic,
        structuredEvidence,
      );
    }
    return { evidence: structuredEvidence, value };
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic verifier for development and browser tests; never contacts Cloudflare. */
export function createDevelopmentHumanVerifier(): HumanVerifier {
  return {
    async verify({ token }) {
      return token === 'development-human-verification'
        ? { verified: true }
        : { verified: false, reason: token === '' ? 'missing' : 'invalid' };
    },
  };
}

/** Fail-closed boundary used when production secret materialization is unavailable. */
export function createUnavailableHumanVerifier(): HumanVerifier {
  return {
    async verify() {
      return { verified: false, reason: 'unavailable' };
    },
  };
}

/** Cloudflare Turnstile verifier with bounded parsing, replay rejection, and one network retry. */
export function createTurnstileHumanVerifier(options: {
  expectedHostname: string;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  onFailure?(diagnostic: HumanVerificationFailureDiagnostic): void;
  secret: string;
  timeoutMs?: number;
}): HumanVerifier {
  const expectedHostname = options.expectedHostname.toLocaleLowerCase('en-US');
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const seen = new Map<string, number>();
  const diagnosticErrorInput = (
    error: TurnstileDiagnosticError | null,
  ): TurnstileStructuredDiagnosticInput => {
    if (error === null) return {};
    const input: TurnstileStructuredDiagnosticInput = {
      ...(error.httpStatusCode === null
        ? {}
        : { httpStatusCode: error.httpStatusCode }),
      ...(error.responseEvidence === null
        ? {}
        : { evidence: error.responseEvidence }),
      request: error.requestDiagnostic,
    };
    const value = error.responseEvidence?.value;
    if (value === undefined) return input;
    const fields = providerFieldEvidence(value);
    const extra = diagnoseProviderExtraFields(value, KNOWN_TURNSTILE_FIELDS);
    const parsed = responseSchema.safeParse(value);
    if (!parsed.success) {
      return {
        ...input,
        fields,
        providerExtraFields: extra,
        schemaIssues: providerSchemaIssues(parsed.error),
      };
    }
    return {
      ...input,
      fields,
      ...(parsed.data.action === undefined
        ? {}
        : { providerAction: parsed.data.action }),
      providerErrorCodes: parsed.data['error-codes'] ?? [],
      providerExtraFields: extra,
      ...(parsed.data.hostname === undefined
        ? {}
        : { providerHostname: parsed.data.hostname }),
      success: parsed.data.success,
    };
  };
  const report = (
    action: HumanVerificationAction,
    category: HumanVerificationFailureDiagnostic['category'],
    attempt: 1 | 2 | null,
    input: {
      challengeAgeMilliseconds?: number;
      challengeTimestamp?: string;
      error?: unknown;
      evidence?: TurnstileResponseEvidence;
      fields?: ReturnType<typeof providerFieldEvidence>;
      httpStatusCode?: number;
      providerAction?: string;
      providerErrorCodes?: string[];
      providerExtraFields?: ProviderValueEntryDiagnostic[];
      providerHostname?: string;
      request?: TurnstileRequestDiagnostic;
      schemaIssues?: ReturnType<typeof providerSchemaIssues>;
      success?: boolean;
    } = {},
  ) => {
    try {
      const response = input.evidence?.response ?? null;
      options.onFailure?.({
        action,
        attempt,
        category,
        httpStatusCode:
          input.httpStatusCode ?? input.evidence?.http.statusCode ?? null,
        operationalError:
          input.error === undefined
            ? null
            : diagnoseProviderOperationalError(input.error),
        providerActionDiagnostic:
          input.providerAction === undefined
            ? null
            : diagnosePrivateProviderText(
                input.providerAction,
                'Private Turnstile action omitted',
              ),
        providerChallengeAgeMilliseconds:
          input.challengeAgeMilliseconds ?? null,
        providerChallengeTimestamp: input.challengeTimestamp ?? null,
        providerErrorCodeDiagnostics: (input.providerErrorCodes ?? []).map(
          (code) =>
            diagnosePrivateProviderText(
              code,
              'Private Turnstile error code omitted',
            ),
        ),
        providerErrorCodes: input.providerErrorCodes ?? [],
        providerExtraFields: input.providerExtraFields ?? [],
        providerFieldNames: input.fields?.names ?? [],
        providerFieldsComplete: input.fields?.complete ?? null,
        providerFieldsObserved: input.fields?.observed ?? 0,
        providerFieldsOmitted: input.fields?.omitted ?? 0,
        providerHostnameDiagnostic:
          input.providerHostname === undefined
            ? null
            : diagnosePrivateProviderText(
                input.providerHostname,
                'Private Turnstile hostname omitted',
              ),
        providerHttp: input.evidence?.http ?? null,
        providerResponseDiagnostic: response,
        providerResponseFingerprint: response?.fingerprint ?? null,
        providerResponseLength: response?.observedByteLength ?? null,
        providerResponseTruncated:
          response === null
            ? null
            : response.inspectionTruncated || response.summaryTruncated,
        providerSchemaIssues: input.schemaIssues?.issues ?? [],
        providerSchemaIssuesComplete: input.schemaIssues?.complete ?? null,
        providerSchemaIssuesObserved: input.schemaIssues?.observed ?? 0,
        providerSchemaIssuesOmitted: input.schemaIssues?.omitted ?? 0,
        providerSuccess: input.success ?? null,
        request: input.request ?? input.evidence?.request ?? null,
        providerActionMatchesExpected:
          input.providerAction === undefined
            ? null
            : input.providerAction === action,
        providerHostnameMatchesExpected:
          input.providerHostname === undefined
            ? null
            : input.providerHostname.toLocaleLowerCase('en-US') ===
              expectedHostname,
      });
    } catch {
      // Diagnostics must never change human-verification admission.
    }
  };

  return {
    async verify({ action, token }) {
      if (token.length === 0) return { verified: false, reason: 'missing' };
      if (token.length > TOKEN_MAX_LENGTH) {
        return { verified: false, reason: 'malformed' };
      }
      const digest = tokenDigest(token);
      const cutoff = now() - TOKEN_RETENTION_MS;
      for (const [recorded, timestamp] of seen) {
        if (timestamp < cutoff) seen.delete(recorded);
      }
      if (seen.has(digest)) return { verified: false, reason: 'duplicate' };
      if (seen.size >= MAX_TOKEN_RECORDS) {
        const oldest = seen.keys().next().value as string | undefined;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.set(digest, now());

      const requestDiagnostic: TurnstileRequestDiagnostic = {
        endpointHost: 'challenges.cloudflare.com',
        expectedAction: action,
        expectedHostnameDiagnostic: diagnosePrivateProviderText(
          expectedHostname,
          'Expected Turnstile hostname omitted',
        ),
        httpMethod: 'POST',
        idempotencyKey: randomUUID(),
        maximumAttempts: 2,
        remoteIpIncluded: false,
        timeoutMilliseconds: timeoutMs,
        tokenDiagnostic: diagnosePrivateProviderText(
          token,
          'Private Turnstile token omitted',
        ),
      };
      let response: Awaited<ReturnType<typeof requestSiteverify>>;
      try {
        response = await requestSiteverify({
          fetchImplementation,
          requestDiagnostic,
          secret: options.secret,
          token,
        });
      } catch (error) {
        const diagnosticError = isErrorInstance(error, TurnstileDiagnosticError)
          ? error
          : null;
        report(action, diagnosticError?.category ?? 'transport', 1, {
          error,
          ...diagnosticErrorInput(diagnosticError),
        });
        if (isErrorInstance(error, TurnstileMalformedResponseError)) {
          return { verified: false, reason: 'malformed' };
        }
        if (!isErrorInstance(error, TurnstileNetworkError)) {
          return { verified: false, reason: 'unavailable' };
        }
        try {
          response = await requestSiteverify({
            fetchImplementation,
            requestDiagnostic,
            secret: options.secret,
            token,
          });
        } catch (retryError) {
          const diagnosticError = isErrorInstance(
            retryError,
            TurnstileDiagnosticError,
          )
            ? retryError
            : null;
          report(action, diagnosticError?.category ?? 'transport', 2, {
            error: retryError,
            ...diagnosticErrorInput(diagnosticError),
          });
          return {
            verified: false,
            reason: isErrorInstance(retryError, TurnstileMalformedResponseError)
              ? 'malformed'
              : 'unavailable',
          };
        }
      }

      const fields = providerFieldEvidence(response.value);
      const providerExtraFields = diagnoseProviderExtraFields(
        response.value,
        KNOWN_TURNSTILE_FIELDS,
      );
      const parsed = responseSchema.safeParse(response.value);
      if (!parsed.success) {
        report(action, 'response-schema', null, {
          evidence: response.evidence,
          fields,
          providerExtraFields,
          schemaIssues: providerSchemaIssues(parsed.error),
        });
        return { verified: false, reason: 'malformed' };
      }
      const structuredEvidence = {
        evidence: response.evidence,
        fields,
        providerExtraFields,
        ...(parsed.data.action === undefined
          ? {}
          : { providerAction: parsed.data.action }),
        ...(parsed.data.hostname === undefined
          ? {}
          : { providerHostname: parsed.data.hostname }),
        success: parsed.data.success,
      };
      if (!parsed.data.success) {
        report(action, 'provider-declined', null, {
          ...structuredEvidence,
          providerErrorCodes: parsed.data['error-codes'] ?? [],
        });
        return { verified: false, reason: 'invalid' };
      }
      if (
        parsed.data.hostname?.toLocaleLowerCase('en-US') !== expectedHostname
      ) {
        report(action, 'hostname-mismatch', null, structuredEvidence);
        return { verified: false, reason: 'mismatch' };
      }
      if (parsed.data.action !== action) {
        report(action, 'action-mismatch', null, structuredEvidence);
        return { verified: false, reason: 'mismatch' };
      }
      const challengeTimestamp = parsed.data.challenge_ts ?? '';
      const challengeTime = Date.parse(challengeTimestamp);
      const age = now() - challengeTime;
      if (
        !Number.isFinite(challengeTime) ||
        age > CHALLENGE_MAX_AGE_MS ||
        age < -CHALLENGE_FUTURE_TOLERANCE_MS
      ) {
        report(action, 'invalid-challenge-time', null, {
          ...structuredEvidence,
          ...(Number.isFinite(challengeTime)
            ? {
                challengeAgeMilliseconds: age,
                challengeTimestamp: new Date(challengeTime).toISOString(),
              }
            : {}),
        });
        return { verified: false, reason: 'stale' };
      }
      return { verified: true };
    },
  };
}
