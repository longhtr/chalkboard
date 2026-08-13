/** Authenticates bounded SNS envelopes before parsing SES events or explicitly confirming ownership. */
import { createHash, createVerify, X509Certificate } from 'node:crypto';

import { z } from 'zod';

import {
  isErrorInstance,
  readUnknownProperty,
  type OperationalErrorDiagnostic,
} from '../operations/errorDiagnostics.js';
import {
  diagnosePrivateProviderText,
  diagnoseProviderExtraFields,
  diagnoseProviderHttp,
  diagnoseProviderOperationalError,
  diagnoseProviderResponseStructure,
  diagnoseProviderValue,
  privatizeProviderTextDiagnostic,
  ProviderBodyReadError,
  readProviderResponseBody,
  type ProviderHttpDiagnostic,
  type ProviderResponseStructureDiagnostic,
  type ProviderTextDiagnostic,
  type ProviderValueDiagnostic,
  type ProviderValueEntryDiagnostic,
} from '../operations/providerDiagnostics.js';
import type { SesFeedbackEvent, SesFeedbackType } from './feedback.js';

const envelopeSchema = z.looseObject({
  Message: z.string().min(1).max(65_536),
  MessageId: z.string().min(1).max(512),
  Signature: z.string().min(1).max(16_384),
  SignatureVersion: z.enum(['1', '2']),
  SigningCertURL: z.string().url().max(2048),
  Subject: z.string().max(1024).optional(),
  SubscribeURL: z.string().url().max(2048).optional(),
  Timestamp: z.string().datetime({ offset: true }),
  Token: z.string().max(4096).optional(),
  TopicArn: z.string().min(1).max(2048),
  Type: z.enum([
    'Notification',
    'SubscriptionConfirmation',
    'UnsubscribeConfirmation',
  ]),
});

export type SnsEnvelope = z.infer<typeof envelopeSchema>;

export interface SnsEnvelopeVerifier {
  verify(value: unknown): Promise<SnsEnvelope>;
}

export type SnsFeedbackFailureReason =
  | 'certificate-fetch'
  | 'certificate-response'
  | 'certificate-url'
  | 'certificate-validity'
  | 'confirmation-input'
  | 'confirmation-request'
  | 'envelope-schema'
  | 'incomplete-control'
  | 'signature'
  | 'topic';

export interface SnsFeedbackFailureDiagnostic {
  certificate: {
    ca: boolean;
    fingerprint256: string | null;
    fingerprint512: string | null;
    hostMatchesExpectedCertificateHost: boolean | null;
    infoAccess: ProviderTextDiagnostic | null;
    issuer: ProviderTextDiagnostic | null;
    keyUsage: ProviderValueDiagnostic;
    publicKeyDetails: ProviderValueDiagnostic;
    publicKeyType: string | null;
    rawByteLength: number;
    serialNumberDiagnostic: ProviderTextDiagnostic | null;
    signatureAlgorithm: string | null;
    signatureAlgorithmOid: string | null;
    subject: ProviderTextDiagnostic | null;
    subjectAltName: ProviderTextDiagnostic | null;
    validFrom: string | null;
    validTo: string | null;
  } | null;
  canonicalFieldNames: string[];
  canonicalMessage: ProviderTextDiagnostic | null;
  certificateCacheHit: boolean | null;
  envelopeExtraFields: ProviderValueEntryDiagnostic[];
  envelopeFieldNames: string[];
  envelopeFieldsComplete: boolean | null;
  envelopeFieldsObserved: number;
  envelopeFieldsOmitted: number;
  envelopeTimestamp: string | null;
  envelopeValues: {
    messageDiagnostic: ProviderTextDiagnostic | null;
    messageIdDiagnostic: ProviderTextDiagnostic | null;
    subjectDiagnostic: ProviderTextDiagnostic | null;
    subscribeUrlDiagnostic: ProviderTextDiagnostic | null;
    timestampDiagnostic: ProviderTextDiagnostic | null;
    tokenDiagnostic: ProviderTextDiagnostic | null;
    topicArnDiagnostic: ProviderTextDiagnostic | null;
    typeDiagnostic: ProviderTextDiagnostic | null;
  };
  operationalError: OperationalErrorDiagnostic | null;
  providerHttp: ProviderHttpDiagnostic | null;
  providerResponseDiagnostic: ProviderTextDiagnostic | null;
  providerResponseStructure: ProviderResponseStructureDiagnostic | null;
  reason: SnsFeedbackFailureReason;
  request: {
    expectedCertificateHost: string;
    expectedRegion: string;
    responseUrlMatchesRequest: boolean | null;
    stage: 'certificate' | 'confirmation' | 'envelope' | 'signature';
  };
  retryable: boolean;
  schemaIssues: Array<{ issueCode: string; path: string }>;
  schemaIssuesComplete: boolean | null;
  schemaIssuesObserved: number;
  schemaIssuesOmitted: number;
  signature: ProviderTextDiagnostic | null;
  signatureAlgorithm: 'RSA-SHA1' | 'RSA-SHA256' | null;
  signatureVersion: '1' | '2' | null;
  signingCertificateUrl: ProviderTextDiagnostic | null;
  topicMatchesExpected: boolean | null;
  type: SnsEnvelope['Type'] | null;
}

const MAX_SNS_FIELDS = 64;
const MAX_SNS_SCHEMA_ISSUES = 32;
const MAX_SNS_RESPONSE_BYTES = 65_536;
const KNOWN_SNS_ENVELOPE_FIELDS = new Set([
  'Message',
  'MessageId',
  'Signature',
  'SignatureVersion',
  'SigningCertURL',
  'Subject',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
]);
const KNOWN_SES_PAYLOAD_FIELDS = new Set([
  'bounce',
  'eventType',
  'mail',
  'notificationType',
]);
const KNOWN_SES_MAIL_FIELDS = new Set(['messageId', 'timestamp']);
const KNOWN_SES_BOUNCE_FIELDS = new Set(['bounceType']);

function objectFields(value: unknown): {
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
    const retained = all.slice(0, MAX_SNS_FIELDS);
    return {
      complete: all.length <= MAX_SNS_FIELDS,
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

function schemaIssueEvidence(
  error: z.ZodError,
): Pick<
  SnsFeedbackFailureDiagnostic,
  | 'schemaIssues'
  | 'schemaIssuesComplete'
  | 'schemaIssuesObserved'
  | 'schemaIssuesOmitted'
> {
  const retained = error.issues.slice(0, MAX_SNS_SCHEMA_ISSUES);
  return {
    schemaIssues: retained.map((issue) => ({
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
    schemaIssuesComplete: error.issues.length <= MAX_SNS_SCHEMA_ISSUES,
    schemaIssuesObserved: error.issues.length,
    schemaIssuesOmitted: Math.max(0, error.issues.length - retained.length),
  };
}

function emptySnsDiagnostic(
  reason: SnsFeedbackFailureReason,
  retryable: boolean,
  stage: SnsFeedbackFailureDiagnostic['request']['stage'],
): SnsFeedbackFailureDiagnostic {
  return {
    certificate: null,
    canonicalFieldNames: [],
    canonicalMessage: null,
    certificateCacheHit: null,
    envelopeExtraFields: [],
    envelopeFieldNames: [],
    envelopeFieldsComplete: null,
    envelopeFieldsObserved: 0,
    envelopeFieldsOmitted: 0,
    envelopeTimestamp: null,
    envelopeValues: {
      messageDiagnostic: null,
      messageIdDiagnostic: null,
      subjectDiagnostic: null,
      subscribeUrlDiagnostic: null,
      timestampDiagnostic: null,
      tokenDiagnostic: null,
      topicArnDiagnostic: null,
      typeDiagnostic: null,
    },
    operationalError: null,
    providerHttp: null,
    providerResponseDiagnostic: null,
    providerResponseStructure: null,
    reason,
    request: {
      expectedCertificateHost: '',
      expectedRegion: '',
      responseUrlMatchesRequest: null,
      stage,
    },
    retryable,
    schemaIssues: [],
    schemaIssuesComplete: null,
    schemaIssuesObserved: 0,
    schemaIssuesOmitted: 0,
    signature: null,
    signatureAlgorithm: null,
    signatureVersion: null,
    signingCertificateUrl: null,
    topicMatchesExpected: null,
    type: null,
  };
}

/** Carries a stable SNS category plus the complete sanitized boundary record. */
export class SnsFeedbackBoundaryError extends Error {
  readonly evidence: SnsFeedbackFailureDiagnostic;

  constructor(
    readonly reason: SnsFeedbackFailureReason,
    readonly retryable: boolean,
    options: ErrorOptions & {
      evidence?: Partial<SnsFeedbackFailureDiagnostic> & {
        request?: Partial<SnsFeedbackFailureDiagnostic['request']>;
      };
    } = {},
  ) {
    super(`SNS feedback boundary failed: ${reason}`, options);
    this.name = 'SnsFeedbackBoundaryError';
    const base = emptySnsDiagnostic(
      reason,
      retryable,
      options.evidence?.request?.stage ?? 'envelope',
    );
    this.evidence = {
      ...base,
      ...options.evidence,
      operationalError:
        options.cause === undefined
          ? (options.evidence?.operationalError ?? null)
          : diagnoseProviderOperationalError(options.cause),
      request: { ...base.request, ...options.evidence?.request },
      reason,
      retryable,
    };
  }

  diagnostic(): SnsFeedbackFailureDiagnostic {
    return this.evidence;
  }
}

const notificationKeys = [
  'Message',
  'MessageId',
  'Subject',
  'Timestamp',
  'TopicArn',
  'Type',
] as const;
const subscriptionKeys = [
  'Message',
  'MessageId',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
] as const;

function canonicalMessage(envelope: SnsEnvelope): string {
  const keys =
    envelope.Type === 'Notification' ? notificationKeys : subscriptionKeys;
  return keys
    .filter((key) => envelope[key] !== undefined)
    .map((key) => `${key}\n${envelope[key]}\n`)
    .join('');
}

function signingCertificateUrl(value: string, region: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.hostname !== `sns.${region}.amazonaws.com` ||
    !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(parsed.pathname)
  ) {
    return null;
  }
  return parsed;
}

function envelopeEvidence(
  value: unknown,
  options: { region: string; topicArn: string },
  envelope?: SnsEnvelope,
): Partial<SnsFeedbackFailureDiagnostic> {
  const fields = objectFields(value);
  const keys =
    envelope?.Type === 'Notification' ? notificationKeys : subscriptionKeys;
  const privateValue = (
    raw: string | undefined,
    label: string,
  ): ProviderTextDiagnostic | null =>
    raw === undefined
      ? null
      : diagnosePrivateProviderText(raw, `Private SNS ${label} omitted`);
  return {
    canonicalFieldNames:
      envelope === undefined
        ? []
        : keys.filter((key) => envelope[key] !== undefined),
    canonicalMessage:
      envelope === undefined
        ? null
        : diagnosePrivateProviderText(
            canonicalMessage(envelope),
            'Private SNS canonical message omitted',
          ),
    certificateCacheHit: null,
    envelopeExtraFields: diagnoseProviderExtraFields(
      value,
      KNOWN_SNS_ENVELOPE_FIELDS,
    ),
    envelopeFieldNames: fields.names,
    envelopeFieldsComplete: fields.complete,
    envelopeFieldsObserved: fields.observed,
    envelopeFieldsOmitted: fields.omitted,
    envelopeTimestamp: envelope?.Timestamp ?? null,
    envelopeValues: {
      messageDiagnostic: privateValue(envelope?.Message, 'message'),
      messageIdDiagnostic: privateValue(
        envelope?.MessageId,
        'message identifier',
      ),
      subjectDiagnostic: privateValue(envelope?.Subject, 'subject'),
      subscribeUrlDiagnostic: privateValue(
        envelope?.SubscribeURL,
        'control URL',
      ),
      timestampDiagnostic: privateValue(envelope?.Timestamp, 'timestamp'),
      tokenDiagnostic: privateValue(envelope?.Token, 'token'),
      topicArnDiagnostic: privateValue(envelope?.TopicArn, 'topic ARN'),
      typeDiagnostic: privateValue(envelope?.Type, 'type'),
    },
    request: {
      expectedCertificateHost: `sns.${options.region}.amazonaws.com`,
      expectedRegion: options.region,
      responseUrlMatchesRequest: null,
      stage: 'envelope',
    },
    signature:
      envelope === undefined
        ? null
        : diagnosePrivateProviderText(
            envelope.Signature,
            'Private SNS signature omitted',
          ),
    signatureAlgorithm:
      envelope === undefined
        ? null
        : envelope.SignatureVersion === '1'
          ? 'RSA-SHA1'
          : 'RSA-SHA256',
    signatureVersion: envelope?.SignatureVersion ?? null,
    signingCertificateUrl:
      envelope === undefined
        ? null
        : diagnosePrivateProviderText(
            envelope.SigningCertURL,
            'Private SNS certificate URL omitted',
          ),
    topicMatchesExpected:
      envelope === undefined ? null : envelope.TopicArn === options.topicArn,
    type: envelope?.Type ?? null,
  };
}

async function boundedResponse(
  response: Response,
  reason: SnsFeedbackFailureReason,
  retryable: boolean,
  evidence: Partial<SnsFeedbackFailureDiagnostic>,
): Promise<Awaited<ReturnType<typeof readProviderResponseBody>>> {
  try {
    const read = await readProviderResponseBody(
      response,
      MAX_SNS_RESPONSE_BYTES,
    );
    if (read.diagnostic.inspectionTruncated) {
      throw new SnsFeedbackBoundaryError(reason, retryable, {
        evidence: {
          ...evidence,
          providerHttp: diagnoseProviderHttp(response),
          providerResponseDiagnostic: privatizeProviderTextDiagnostic(
            read.diagnostic,
            'Private SNS response body omitted',
          ),
          providerResponseStructure: diagnoseProviderResponseStructure(
            read.text,
            {
              sourceByteLength: read.diagnostic.observedByteLength,
              sourceByteLengthComplete: read.diagnostic.byteLengthComplete,
              utf8Valid: read.diagnostic.utf8Valid,
            },
          ),
        },
      });
    }
    return {
      ...read,
      diagnostic: privatizeProviderTextDiagnostic(
        read.diagnostic,
        'Private SNS response body omitted',
      ),
    };
  } catch (error) {
    if (isErrorInstance(error, SnsFeedbackBoundaryError)) throw error;
    if (isErrorInstance(error, ProviderBodyReadError)) {
      throw new SnsFeedbackBoundaryError(reason, retryable, {
        cause: error,
        evidence: {
          ...evidence,
          providerHttp: diagnoseProviderHttp(response),
          providerResponseDiagnostic: privatizeProviderTextDiagnostic(
            error.diagnostic,
            'Private SNS response body omitted',
          ),
          providerResponseStructure: diagnoseProviderResponseStructure(
            error.retainedText,
            {
              sourceByteLength: error.diagnostic.observedByteLength,
              sourceByteLengthComplete: error.diagnostic.byteLengthComplete,
              utf8Valid: error.diagnostic.utf8Valid,
            },
          ),
        },
      });
    }
    throw new SnsFeedbackBoundaryError(reason, retryable, {
      cause: error,
      evidence,
    });
  }
}

/** Verifies exact topic ownership and an SNS v1/v2 signature before use. */
export function createSnsEnvelopeVerifier(options: {
  fetch?: typeof fetch;
  region: string;
  topicArn: string;
}): SnsEnvelopeVerifier {
  const fetchCertificate = options.fetch ?? fetch;
  const cache = new Map<
    string,
    {
      certificate: string;
      diagnostic: Pick<
        SnsFeedbackFailureDiagnostic,
        | 'certificate'
        | 'providerHttp'
        | 'providerResponseDiagnostic'
        | 'providerResponseStructure'
      >;
      expiresAt: number;
    }
  >();
  return {
    async verify(value) {
      const rawValue =
        typeof value === 'string'
          ? (() => {
              try {
                return JSON.parse(value) as unknown;
              } catch (error) {
                throw new SnsFeedbackBoundaryError('envelope-schema', false, {
                  cause: error,
                  evidence: {
                    providerResponseDiagnostic: diagnosePrivateProviderText(
                      value,
                      'Private SNS envelope omitted',
                    ),
                    request: {
                      expectedCertificateHost: `sns.${options.region}.amazonaws.com`,
                      expectedRegion: options.region,
                      responseUrlMatchesRequest: null,
                      stage: 'envelope',
                    },
                  },
                });
              }
            })()
          : value;
      const parsedEnvelope = envelopeSchema.safeParse(rawValue);
      if (!parsedEnvelope.success) {
        throw new SnsFeedbackBoundaryError('envelope-schema', false, {
          evidence: {
            ...envelopeEvidence(rawValue, options),
            ...schemaIssueEvidence(parsedEnvelope.error),
          },
        });
      }
      const envelope = parsedEnvelope.data;
      const baseEvidence = envelopeEvidence(rawValue, options, envelope);
      if (envelope.TopicArn !== options.topicArn) {
        throw new SnsFeedbackBoundaryError('topic', false, {
          evidence: baseEvidence,
        });
      }
      if (
        envelope.Type !== 'Notification' &&
        (envelope.SubscribeURL === undefined || envelope.Token === undefined)
      ) {
        throw new SnsFeedbackBoundaryError('incomplete-control', false, {
          evidence: baseEvidence,
        });
      }
      const certificateUrl = signingCertificateUrl(
        envelope.SigningCertURL,
        options.region,
      );
      if (certificateUrl === null) {
        throw new SnsFeedbackBoundaryError('certificate-url', false, {
          evidence: baseEvidence,
        });
      }
      const certificateEvidence = {
        ...baseEvidence,
        request: {
          expectedCertificateHost: `sns.${options.region}.amazonaws.com`,
          expectedRegion: options.region,
          responseUrlMatchesRequest: null,
          stage: 'certificate' as const,
        },
      };
      let cached = cache.get(certificateUrl.href);
      const certificateCacheHit =
        cached !== undefined && cached.expiresAt > Date.now();
      if (!certificateCacheHit) {
        certificateEvidence.certificateCacheHit = false;
        let response: Response;
        try {
          response = await fetchCertificate(certificateUrl, {
            redirect: 'error',
            signal: AbortSignal.timeout(3000),
          });
        } catch (error) {
          throw new SnsFeedbackBoundaryError('certificate-fetch', true, {
            cause: error,
            evidence: certificateEvidence,
          });
        }
        const providerHttp = diagnoseProviderHttp(response);
        const responseUrlMatchesRequest = response.url === certificateUrl.href;
        const read = await boundedResponse(
          response,
          response.ok ? 'certificate-response' : 'certificate-fetch',
          true,
          {
            ...certificateEvidence,
            providerHttp,
            request: {
              ...certificateEvidence.request,
              responseUrlMatchesRequest,
            },
          },
        );
        const responseEvidence = {
          ...certificateEvidence,
          providerHttp,
          providerResponseDiagnostic: read.diagnostic,
          providerResponseStructure: diagnoseProviderResponseStructure(
            read.text,
            {
              sourceByteLength: read.diagnostic.observedByteLength,
              sourceByteLengthComplete: read.diagnostic.byteLengthComplete,
              utf8Valid: read.diagnostic.utf8Valid,
            },
          ),
          request: {
            ...certificateEvidence.request,
            responseUrlMatchesRequest,
          },
        };
        if (!response.ok) {
          throw new SnsFeedbackBoundaryError('certificate-fetch', true, {
            evidence: responseEvidence,
          });
        }
        if (!responseUrlMatchesRequest) {
          throw new SnsFeedbackBoundaryError('certificate-response', false, {
            evidence: responseEvidence,
          });
        }
        const certificate = read.text;
        let parsedCertificate: X509Certificate;
        try {
          parsedCertificate = new X509Certificate(certificate);
        } catch (error) {
          throw new SnsFeedbackBoundaryError('certificate-response', true, {
            cause: error,
            evidence: responseEvidence,
          });
        }
        const validFrom = Date.parse(parsedCertificate.validFrom);
        const validTo = Date.parse(parsedCertificate.validTo);
        const optionalCertificateString = (key: PropertyKey): string | null => {
          const value = readUnknownProperty(parsedCertificate, key);
          return typeof value === 'string' && value.length > 0 ? value : null;
        };
        const publicKey = readUnknownProperty(parsedCertificate, 'publicKey');
        const publicKeyType = readUnknownProperty(
          publicKey,
          'asymmetricKeyType',
        );
        const keyUsage = readUnknownProperty(parsedCertificate, 'keyUsage');
        const raw = readUnknownProperty(parsedCertificate, 'raw');
        let hostMatchesExpectedCertificateHost: boolean | null;
        try {
          hostMatchesExpectedCertificateHost =
            parsedCertificate.checkHost(certificateUrl.hostname) !== undefined;
        } catch {
          hostMatchesExpectedCertificateHost = null;
        }
        const fingerprint512 = optionalCertificateString('fingerprint512');
        const infoAccess = optionalCertificateString('infoAccess');
        const signatureAlgorithm =
          optionalCertificateString('signatureAlgorithm');
        const signatureAlgorithmOid = optionalCertificateString(
          'signatureAlgorithmOid',
        );
        const subjectAltName = optionalCertificateString('subjectAltName');
        const rawByteLength = readUnknownProperty(raw, 'byteLength');
        const parsedCertificateEvidence = {
          ...responseEvidence,
          certificate: {
            ca: parsedCertificate.ca,
            fingerprint256: parsedCertificate.fingerprint256 || null,
            fingerprint512:
              fingerprint512 !== null &&
              /^[A-Fa-f0-9:]{1,512}$/u.test(fingerprint512)
                ? fingerprint512
                : null,
            hostMatchesExpectedCertificateHost,
            infoAccess:
              infoAccess === null
                ? null
                : diagnosePrivateProviderText(
                    infoAccess,
                    'Private certificate information-access value omitted',
                  ),
            issuer: diagnosePrivateProviderText(
              parsedCertificate.issuer,
              'Private certificate issuer omitted',
            ),
            keyUsage: diagnoseProviderValue(keyUsage),
            publicKeyDetails: diagnoseProviderValue(
              readUnknownProperty(publicKey, 'asymmetricKeyDetails'),
            ),
            publicKeyType:
              typeof publicKeyType === 'string' &&
              /^[A-Za-z0-9_-]{1,64}$/u.test(publicKeyType)
                ? publicKeyType
                : null,
            rawByteLength:
              typeof rawByteLength === 'number' &&
              Number.isSafeInteger(rawByteLength) &&
              rawByteLength >= 0
                ? rawByteLength
                : 0,
            serialNumberDiagnostic:
              parsedCertificate.serialNumber.length === 0
                ? null
                : diagnosePrivateProviderText(
                    parsedCertificate.serialNumber,
                    'Private certificate serial number omitted',
                  ),
            signatureAlgorithm:
              signatureAlgorithm !== null &&
              /^[A-Za-z0-9 ._+/-]{1,128}$/u.test(signatureAlgorithm)
                ? signatureAlgorithm
                : null,
            signatureAlgorithmOid:
              signatureAlgorithmOid !== null &&
              /^[0-9.]{1,128}$/u.test(signatureAlgorithmOid)
                ? signatureAlgorithmOid
                : null,
            subject: diagnosePrivateProviderText(
              parsedCertificate.subject,
              'Private certificate subject omitted',
            ),
            subjectAltName:
              subjectAltName === null
                ? null
                : diagnosePrivateProviderText(
                    subjectAltName,
                    'Private certificate subject alternative name omitted',
                  ),
            validFrom: Number.isFinite(validFrom)
              ? new Date(validFrom).toISOString()
              : null,
            validTo: Number.isFinite(validTo)
              ? new Date(validTo).toISOString()
              : null,
          },
          certificateCacheHit: false,
        };
        if (
          !Number.isFinite(validFrom) ||
          !Number.isFinite(validTo) ||
          Date.now() < validFrom ||
          Date.now() > validTo
        ) {
          throw new SnsFeedbackBoundaryError('certificate-validity', true, {
            evidence: parsedCertificateEvidence,
          });
        }
        cached = {
          certificate,
          diagnostic: {
            certificate: parsedCertificateEvidence.certificate,
            providerHttp: parsedCertificateEvidence.providerHttp,
            providerResponseDiagnostic:
              parsedCertificateEvidence.providerResponseDiagnostic === null
                ? null
                : privatizeProviderTextDiagnostic(
                    parsedCertificateEvidence.providerResponseDiagnostic,
                    'SNS signing certificate body omitted',
                  ),
            providerResponseStructure:
              parsedCertificateEvidence.providerResponseStructure,
          },
          expiresAt: Math.min(validTo, Date.now() + 60 * 60 * 1000),
        };
        if (cache.size >= 4) cache.delete(cache.keys().next().value ?? '');
        cache.set(certificateUrl.href, cached);
      }
      if (cached === undefined) {
        throw new SnsFeedbackBoundaryError('certificate-response', true, {
          evidence: {
            ...certificateEvidence,
            certificateCacheHit,
          },
        });
      }
      const signatureEvidence = {
        ...baseEvidence,
        ...cached.diagnostic,
        certificateCacheHit,
        request: {
          expectedCertificateHost: `sns.${options.region}.amazonaws.com`,
          expectedRegion: options.region,
          responseUrlMatchesRequest: null,
          stage: 'signature' as const,
        },
      };
      try {
        const verifier = createVerify(
          envelope.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
        );
        verifier.update(canonicalMessage(envelope), 'utf8');
        verifier.end();
        if (
          !verifier.verify(cached.certificate, envelope.Signature, 'base64')
        ) {
          throw new SnsFeedbackBoundaryError('signature', false, {
            evidence: signatureEvidence,
          });
        }
      } catch (error) {
        if (isErrorInstance(error, SnsFeedbackBoundaryError)) throw error;
        throw new SnsFeedbackBoundaryError('signature', false, {
          cause: error,
          evidence: signatureEvidence,
        });
      }
      return envelope;
    },
  };
}

const sesMessageSchema = z.looseObject({
  bounce: z
    .looseObject({ bounceType: z.string().max(64).optional() })
    .optional(),
  eventType: z.string().min(1).max(64).optional(),
  mail: z.looseObject({
    messageId: z.string().min(1).max(512),
    timestamp: z.string().datetime({ offset: true }).optional(),
  }),
  notificationType: z.string().min(1).max(64).optional(),
});

const eventTypes: Readonly<Record<string, SesFeedbackType>> = {
  BOUNCE: 'bounce',
  COMPLAINT: 'complaint',
  DELIVERY: 'delivery',
  DELIVERYDELAY: 'delivery-delay',
  REJECT: 'reject',
  RENDERINGFAILURE: 'rendering-failure',
  SEND: 'send',
};

export interface SesFeedbackPayloadDiagnostic {
  bounceExtraFields: ProviderValueEntryDiagnostic[];
  bounceFieldNames: string[];
  bounceFieldsComplete: boolean | null;
  bounceFieldsObserved: number;
  bounceFieldsOmitted: number;
  eventTypeDiagnostic: ProviderTextDiagnostic | null;
  mailExtraFields: ProviderValueEntryDiagnostic[];
  mailFieldNames: string[];
  mailFieldsComplete: boolean | null;
  mailFieldsObserved: number;
  mailFieldsOmitted: number;
  providerEventIdFingerprint: string;
  providerMessageIdFingerprint: string | null;
  providerPayloadDiagnostic: ProviderTextDiagnostic;
  rootExtraFields: ProviderValueEntryDiagnostic[];
  rootFieldNames: string[];
  rootFieldsComplete: boolean | null;
  rootFieldsObserved: number;
  rootFieldsOmitted: number;
  schemaIssues: Array<{ issueCode: string; path: string }>;
  schemaIssuesComplete: boolean | null;
  schemaIssuesObserved: number;
  schemaIssuesOmitted: number;
  stage: 'event-type' | 'json' | 'schema' | 'supported-event';
}

function feedbackPayloadBase(
  envelope: SnsEnvelope,
): SesFeedbackPayloadDiagnostic {
  return {
    bounceExtraFields: [],
    bounceFieldNames: [],
    bounceFieldsComplete: null,
    bounceFieldsObserved: 0,
    bounceFieldsOmitted: 0,
    eventTypeDiagnostic: null,
    mailExtraFields: [],
    mailFieldNames: [],
    mailFieldsComplete: null,
    mailFieldsObserved: 0,
    mailFieldsOmitted: 0,
    providerEventIdFingerprint: createHash('sha256')
      .update(envelope.MessageId)
      .digest('hex'),
    providerMessageIdFingerprint: null,
    providerPayloadDiagnostic: diagnosePrivateProviderText(
      envelope.Message,
      'Private authenticated SES event payload omitted',
    ),
    rootExtraFields: [],
    rootFieldNames: [],
    rootFieldsComplete: null,
    rootFieldsObserved: 0,
    rootFieldsOmitted: 0,
    schemaIssues: [],
    schemaIssuesComplete: null,
    schemaIssuesObserved: 0,
    schemaIssuesOmitted: 0,
    stage: 'json',
  };
}

export class SesFeedbackPayloadError extends Error {
  constructor(
    readonly diagnostic: SesFeedbackPayloadDiagnostic,
    options: ErrorOptions = {},
  ) {
    super('Authenticated SES feedback payload was invalid', options);
    this.name = 'SesFeedbackPayloadError';
  }
}

export type SesFeedbackParseResult =
  | { diagnostic: SesFeedbackPayloadDiagnostic; event: SesFeedbackEvent }
  | { diagnostic: SesFeedbackPayloadDiagnostic; event: null };

/** Parses one authenticated SES event and returns sanitized parse evidence. */
export function parseSesFeedbackDetailed(
  envelope: SnsEnvelope,
): SesFeedbackParseResult {
  const base = feedbackPayloadBase(envelope);
  let rawMessage: unknown;
  try {
    rawMessage = JSON.parse(envelope.Message) as unknown;
  } catch (error) {
    throw new SesFeedbackPayloadError(base, { cause: error });
  }
  const rootFields = objectFields(rawMessage);
  const parsed = sesMessageSchema.safeParse(rawMessage);
  if (!parsed.success) {
    const issues = schemaIssueEvidence(parsed.error);
    throw new SesFeedbackPayloadError({
      ...base,
      rootExtraFields: diagnoseProviderExtraFields(
        rawMessage,
        KNOWN_SES_PAYLOAD_FIELDS,
      ),
      rootFieldNames: rootFields.names,
      rootFieldsComplete: rootFields.complete,
      rootFieldsObserved: rootFields.observed,
      rootFieldsOmitted: rootFields.omitted,
      ...issues,
      stage: 'schema',
    });
  }
  const message = parsed.data;
  const mailFields = objectFields(message.mail);
  const bounceFields = objectFields(message.bounce);
  const rawProviderType = message.eventType ?? message.notificationType ?? '';
  const rawType = rawProviderType.replaceAll(/[^A-Za-z]/g, '').toUpperCase();
  const eventType = eventTypes[rawType];
  const diagnostic: SesFeedbackPayloadDiagnostic = {
    ...base,
    bounceExtraFields: diagnoseProviderExtraFields(
      message.bounce,
      KNOWN_SES_BOUNCE_FIELDS,
    ),
    bounceFieldNames: bounceFields.names,
    bounceFieldsComplete: bounceFields.complete,
    bounceFieldsObserved: bounceFields.observed,
    bounceFieldsOmitted: bounceFields.omitted,
    eventTypeDiagnostic:
      rawProviderType === ''
        ? null
        : diagnosePrivateProviderText(
            rawProviderType,
            'Private SES event type omitted',
          ),
    mailExtraFields: diagnoseProviderExtraFields(
      message.mail,
      KNOWN_SES_MAIL_FIELDS,
    ),
    mailFieldNames: mailFields.names,
    mailFieldsComplete: mailFields.complete,
    mailFieldsObserved: mailFields.observed,
    mailFieldsOmitted: mailFields.omitted,
    providerMessageIdFingerprint: createHash('sha256')
      .update(message.mail.messageId)
      .digest('hex'),
    rootExtraFields: diagnoseProviderExtraFields(
      message,
      KNOWN_SES_PAYLOAD_FIELDS,
    ),
    rootFieldNames: rootFields.names,
    rootFieldsComplete: rootFields.complete,
    rootFieldsObserved: rootFields.observed,
    rootFieldsOmitted: rootFields.omitted,
    stage: eventType === undefined ? 'event-type' : 'supported-event',
  };
  if (eventType === undefined) return { diagnostic, event: null };
  const occurredAt =
    message.mail.timestamp === undefined
      ? undefined
      : new Date(message.mail.timestamp);
  return {
    diagnostic,
    event: {
      ...(eventType === 'bounce'
        ? {
            bounceType:
              message.bounce?.bounceType?.toLowerCase() === 'permanent'
                ? ('permanent' as const)
                : message.bounce?.bounceType?.toLowerCase() === 'transient'
                  ? ('transient' as const)
                  : ('undetermined' as const),
          }
        : {}),
      eventType,
      ...(occurredAt === undefined ? {} : { occurredAt }),
      providerEventId: envelope.MessageId,
      providerMessageId: message.mail.messageId,
    },
  };
}

/** Confirms only the exact, already-verified subscription when explicitly enabled. */
export async function confirmSnsSubscription(
  envelope: SnsEnvelope,
  options: { fetch?: typeof fetch; region: string; topicArn: string },
): Promise<SnsFeedbackFailureDiagnostic> {
  const confirmationEvidence = {
    ...envelopeEvidence(envelope, options, envelope),
    request: {
      expectedCertificateHost: `sns.${options.region}.amazonaws.com`,
      expectedRegion: options.region,
      responseUrlMatchesRequest: null,
      stage: 'confirmation' as const,
    },
  };
  if (
    envelope.Type !== 'SubscriptionConfirmation' ||
    envelope.SubscribeURL === undefined ||
    envelope.Token === undefined
  ) {
    throw new SnsFeedbackBoundaryError('confirmation-input', false, {
      evidence: confirmationEvidence,
    });
  }
  const url = new URL(envelope.SubscribeURL);
  const parameters = [...url.searchParams.keys()];
  if (
    url.protocol !== 'https:' ||
    url.hostname !== `sns.${options.region}.amazonaws.com` ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.hash !== '' ||
    parameters.length !== 3 ||
    parameters.some((key) => !['Action', 'TopicArn', 'Token'].includes(key)) ||
    url.searchParams.get('Action') !== 'ConfirmSubscription' ||
    url.searchParams.get('TopicArn') !== options.topicArn ||
    url.searchParams.get('Token') !== envelope.Token
  ) {
    throw new SnsFeedbackBoundaryError('confirmation-input', false, {
      evidence: confirmationEvidence,
    });
  }
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    throw new SnsFeedbackBoundaryError('confirmation-request', true, {
      cause: error,
      evidence: confirmationEvidence,
    });
  }
  const providerHttp = diagnoseProviderHttp(response);
  // Native test Responses have an empty URL; real Fetch responses expose the
  // final URL. A non-empty different value proves an unexpected redirect.
  const responseUrlMatchesRequest =
    response.url === '' || response.url === url.href;
  const read = await boundedResponse(response, 'confirmation-request', true, {
    ...confirmationEvidence,
    providerHttp,
    request: {
      ...confirmationEvidence.request,
      responseUrlMatchesRequest,
    },
  });
  const diagnostic: SnsFeedbackFailureDiagnostic = {
    ...emptySnsDiagnostic('confirmation-request', false, 'confirmation'),
    ...confirmationEvidence,
    providerHttp,
    providerResponseDiagnostic: read.diagnostic,
    providerResponseStructure: diagnoseProviderResponseStructure(read.text, {
      sourceByteLength: read.diagnostic.observedByteLength,
      sourceByteLengthComplete: read.diagnostic.byteLengthComplete,
      utf8Valid: read.diagnostic.utf8Valid,
    }),
    request: {
      ...confirmationEvidence.request,
      responseUrlMatchesRequest,
    },
    retryable: false,
  };
  if (!response.ok || !responseUrlMatchesRequest) {
    throw new SnsFeedbackBoundaryError('confirmation-request', true, {
      evidence: diagnostic,
    });
  }
  return diagnostic;
}

/** Compatibility projection of the detailed authenticated-payload parser. */
export function parseSesFeedback(
  envelope: SnsEnvelope,
): SesFeedbackEvent | null {
  if (envelope.Type !== 'Notification') return null;
  return parseSesFeedbackDetailed(envelope).event;
}
