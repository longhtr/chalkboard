/** Verifies signed Resend webhooks and reduces them to minimum feedback metadata. */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import {
  diagnosePrivateProviderText,
  diagnoseProviderOperationalError,
  type ProviderTextDiagnostic,
} from '../operations/providerDiagnostics.js';
import type { OperationalErrorDiagnostic } from '../operations/errorDiagnostics.js';

import type { EmailFeedbackEvent, EmailFeedbackType } from './feedback.js';

/**
 * Svix does not publish a tolerance constant, so this window is our choice
 * rather than a provider contract. Five minutes matches the value the Svix
 * reference receivers use and bounds replay of a captured signed body.
 */
const DEFAULT_TOLERANCE_SECONDS = 300;
const MAX_SIGNATURE_ENTRIES = 16;
const MAX_BODY_BYTES = 64 * 1_024;
const MAX_SCHEMA_ISSUES = 32;
const MAX_PAYLOAD_EXTRA_FIELDS = 32;
const SIGNATURE_BYTE_LENGTH = 32;

export type ResendFeedbackFailureReason =
  | 'body'
  | 'header-shape'
  | 'payload-schema'
  | 'signature'
  | 'signing-secret'
  | 'timestamp';

export interface ResendFeedbackFailureDiagnostic {
  bodyDiagnostic: ProviderTextDiagnostic | null;
  eventType: string | null;
  headerShape: {
    idPresent: boolean;
    idRepeated: boolean;
    signaturePresent: boolean;
    signatureRepeated: boolean;
    timestampPresent: boolean;
    timestampRepeated: boolean;
  };
  operationalError: OperationalErrorDiagnostic | null;
  payloadExtraFieldNames: string[];
  reason: ResendFeedbackFailureReason;
  retryable: boolean;
  schemaIssues: Array<{ issueCode: string; path: string }>;
  schemaIssuesComplete: boolean;
  schemaIssuesObserved: number;
  schemaIssuesOmitted: number;
  signatureEntriesMalformed: number;
  signatureEntriesObserved: number;
  signatureEntriesOmitted: number;
  signatureVersionsObserved: string[];
  supportedSignatureEntries: number;
  timestampSkewSeconds: number | null;
  toleranceSeconds: number;
}

function emptyResendDiagnostic(
  reason: ResendFeedbackFailureReason,
  retryable: boolean,
  toleranceSeconds: number,
): ResendFeedbackFailureDiagnostic {
  return {
    bodyDiagnostic: null,
    eventType: null,
    headerShape: {
      idPresent: false,
      idRepeated: false,
      signaturePresent: false,
      signatureRepeated: false,
      timestampPresent: false,
      timestampRepeated: false,
    },
    operationalError: null,
    payloadExtraFieldNames: [],
    reason,
    retryable,
    schemaIssues: [],
    schemaIssuesComplete: true,
    schemaIssuesObserved: 0,
    schemaIssuesOmitted: 0,
    signatureEntriesMalformed: 0,
    signatureEntriesObserved: 0,
    signatureEntriesOmitted: 0,
    signatureVersionsObserved: [],
    supportedSignatureEntries: 0,
    timestampSkewSeconds: null,
    toleranceSeconds,
  };
}

export class ResendFeedbackBoundaryError extends Error {
  readonly evidence: ResendFeedbackFailureDiagnostic;

  constructor(
    readonly reason: ResendFeedbackFailureReason,
    readonly retryable: boolean,
    options: ErrorOptions & {
      evidence?: Partial<ResendFeedbackFailureDiagnostic>;
      toleranceSeconds?: number;
    } = {},
  ) {
    super(`Resend feedback boundary failed: ${reason}`, options);
    this.name = 'ResendFeedbackBoundaryError';
    const base = emptyResendDiagnostic(
      reason,
      retryable,
      options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    );
    this.evidence = {
      ...base,
      ...options.evidence,
      headerShape: { ...base.headerShape, ...options.evidence?.headerShape },
      operationalError:
        options.cause === undefined
          ? (options.evidence?.operationalError ?? null)
          : diagnoseProviderOperationalError(options.cause),
      reason,
      retryable,
    };
  }

  diagnostic(): ResendFeedbackFailureDiagnostic {
    return this.evidence;
  }
}

export interface ResendWebhookHeaders {
  [name: string]: string | string[] | undefined;
}

export interface ResendWebhookMessage {
  /** The Svix message identifier, stable across provider retries. */
  id: string;
  payload: unknown;
  timestampSeconds: number;
}

export interface ResendWebhookVerifier {
  verify(input: {
    body: unknown;
    headers: ResendWebhookHeaders;
  }): ResendWebhookMessage;
}

/**
 * Decodes the endpoint signing secret. Svix prefixes the shared secret with
 * `whsec_` and base64 encodes the bytes after it.
 */
function decodeSigningSecret(secret: string): Buffer {
  const encoded = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new ResendFeedbackBoundaryError('signing-secret', false);
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.byteLength < 16) {
    throw new ResendFeedbackBoundaryError('signing-secret', false);
  }
  return key;
}

function singleHeader(
  headers: ResendWebhookHeaders,
  name: string,
): { repeated: boolean; value: string | null } {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (raw === undefined) return { repeated: false, value: null };
  if (Array.isArray(raw)) {
    // A repeated signed header is ambiguous about which value was signed.
    return {
      repeated: raw.length > 1,
      value: raw.length === 1 ? raw[0]! : null,
    };
  }
  return { repeated: false, value: raw };
}

/** Verifies the Svix signature over the exact bytes the provider signed. */
export function createResendWebhookVerifier(options: {
  now?(): Date;
  signingSecret: string;
  toleranceSeconds?: number;
}): ResendWebhookVerifier {
  const key = decodeSigningSecret(options.signingSecret);
  const toleranceSeconds =
    options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? (() => new Date());

  return {
    verify({ body, headers }) {
      const id = singleHeader(headers, 'svix-id');
      const timestamp = singleHeader(headers, 'svix-timestamp');
      const signature = singleHeader(headers, 'svix-signature');
      const headerShape = {
        idPresent: id.value !== null || id.repeated,
        idRepeated: id.repeated,
        signaturePresent: signature.value !== null || signature.repeated,
        signatureRepeated: signature.repeated,
        timestampPresent: timestamp.value !== null || timestamp.repeated,
        timestampRepeated: timestamp.repeated,
      };
      const fail = (
        reason: ResendFeedbackFailureReason,
        evidence: Partial<ResendFeedbackFailureDiagnostic> = {},
      ): never => {
        throw new ResendFeedbackBoundaryError(reason, false, {
          evidence: { headerShape, ...evidence },
          toleranceSeconds,
        });
      };

      // The identifier is stored as the deduplication key, so it is bounded and
      // grammar-checked here rather than being refused later as unstorable
      // metadata, which would return a retryable 503 for a malformed request.
      if (
        id.value === null ||
        timestamp.value === null ||
        signature.value === null ||
        signature.value.length === 0 ||
        !/^[A-Za-z0-9._:+/=-]{1,512}$/u.test(id.value)
      ) {
        fail('header-shape');
      }
      // The signature covers exact bytes, so the body must never have been
      // parsed and reserialized before reaching this boundary.
      if (typeof body !== 'string') {
        fail('body');
      }
      const rawBody = body as string;
      const bodyByteLength = Buffer.byteLength(rawBody, 'utf8');
      if (bodyByteLength === 0 || bodyByteLength > MAX_BODY_BYTES) {
        // The complete body is fingerprinted rather than a prefix: a prefix
        // hash would be reported as covering the whole value. The body is
        // already bounded by the server's request limit, and the summary is
        // omitted, so no provider prose is retained either way.
        fail('body', {
          bodyDiagnostic: diagnosePrivateProviderText(
            rawBody,
            'Rejected Resend webhook body omitted',
          ),
        });
      }

      if (!/^\d{1,15}$/u.test(timestamp.value!)) {
        fail('timestamp');
      }
      const timestampSeconds = Number(timestamp.value);
      const skewSeconds =
        Math.floor(now().getTime() / 1_000) - timestampSeconds;
      if (
        !Number.isSafeInteger(timestampSeconds) ||
        Math.abs(skewSeconds) > toleranceSeconds
      ) {
        fail('timestamp', { timestampSkewSeconds: skewSeconds });
      }

      const signedContent = `${id.value}.${timestamp.value}.${rawBody}`;
      const expected = createHmac('sha256', key)
        .update(signedContent, 'utf8')
        .digest();

      const entries = signature
        .value!.split(' ')
        .filter((entry) => entry.length > 0);
      const observedEntries = entries.length;
      const inspected = entries.slice(0, MAX_SIGNATURE_ENTRIES);
      const versionsObserved = new Set<string>();
      let malformed = 0;
      let supported = 0;
      let matched = false;
      for (const entry of inspected) {
        const separator = entry.indexOf(',');
        if (separator <= 0) {
          malformed += 1;
          continue;
        }
        const version = entry.slice(0, separator);
        versionsObserved.add(version);
        if (version !== 'v1') continue;
        supported += 1;
        const candidate = Buffer.from(entry.slice(separator + 1), 'base64');
        if (candidate.byteLength !== SIGNATURE_BYTE_LENGTH) {
          malformed += 1;
          continue;
        }
        // Every supported entry is compared so a match never depends on order.
        if (timingSafeEqual(candidate, expected)) matched = true;
      }
      if (!matched) {
        fail('signature', {
          signatureEntriesMalformed: malformed,
          signatureEntriesObserved: observedEntries,
          signatureEntriesOmitted: Math.max(
            0,
            observedEntries - inspected.length,
          ),
          signatureVersionsObserved: [...versionsObserved].sort(),
          supportedSignatureEntries: supported,
          timestampSkewSeconds: skewSeconds,
        });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch (error) {
        throw new ResendFeedbackBoundaryError('body', false, {
          cause: error,
          evidence: { headerShape },
          toleranceSeconds,
        });
      }
      return { id: id.value!, payload, timestampSeconds };
    },
  };
}

const bounceSchema = z.object({
  message: z.string().max(2_048).optional(),
  subType: z.string().max(256).optional(),
  type: z.string().max(256).optional(),
});

/**
 * Only the fields this application retains are modelled. Resend also sends the
 * plaintext recipient, subject and sender, which must never leave this
 * boundary: the feedback store keeps digests and provider identifiers alone.
 */
const payloadSchema = z.object({
  created_at: z.string().min(1).max(64),
  data: z.object({
    bounce: bounceSchema.optional(),
    email_id: z.string().min(1).max(512),
  }),
  type: z.string().min(1).max(128),
});

const EVENT_TYPES: Record<string, EmailFeedbackType> = {
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
  'email.delivered': 'delivery',
  'email.delivery_delayed': 'delivery-delay',
  'email.failed': 'reject',
  'email.sent': 'send',
};

export interface ResendFeedbackPayloadDiagnostic {
  eventType: string | null;
  ignoredReason: 'unsupported-event-type' | null;
  payloadExtraFieldNames: string[];
}

const KNOWN_PAYLOAD_FIELDS = new Set(['created_at', 'data', 'type']);

/**
 * Records only the names of unexpected top-level fields. The verified payload
 * carries the plaintext recipient and subject inside `data`, so no provider
 * value from this boundary is ever placed in a diagnostic.
 */
function payloadExtraFieldNames(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return [];
  let names: string[];
  try {
    names = Object.keys(value);
  } catch {
    return [];
  }
  return names
    .filter((name) => !KNOWN_PAYLOAD_FIELDS.has(name))
    .slice(0, MAX_PAYLOAD_EXTRA_FIELDS)
    .map((name) =>
      /^[A-Za-z0-9_$.-]{1,128}$/u.test(name) ? name : '[private-field]',
    );
}

export type ResendFeedbackParseResult = {
  diagnostic: ResendFeedbackPayloadDiagnostic;
  event: EmailFeedbackEvent | null;
};

function normalizeBounceType(
  value: string | undefined,
): 'permanent' | 'transient' | 'undetermined' {
  switch (value?.toLowerCase()) {
    case 'permanent':
      return 'permanent';
    case 'temporary':
    case 'transient':
      return 'transient';
    default:
      return 'undetermined';
  }
}

/** Reduces one verified webhook to the metadata the feedback store accepts. */
export function parseResendFeedbackDetailed(
  message: ResendWebhookMessage,
): ResendFeedbackParseResult {
  const result = payloadSchema.safeParse(message.payload);
  if (!result.success) {
    const issues = result.error.issues;
    throw new ResendFeedbackBoundaryError('payload-schema', false, {
      evidence: {
        schemaIssues: issues.slice(0, MAX_SCHEMA_ISSUES).map((issue) => ({
          issueCode: issue.code,
          path: issue.path.join('.'),
        })),
        schemaIssuesComplete: issues.length <= MAX_SCHEMA_ISSUES,
        schemaIssuesObserved: issues.length,
        schemaIssuesOmitted: Math.max(0, issues.length - MAX_SCHEMA_ISSUES),
      },
    });
  }
  const payload = result.data;
  const eventType = EVENT_TYPES[payload.type];
  const extraFieldNames = payloadExtraFieldNames(message.payload);
  if (eventType === undefined) {
    // Tracking and lifecycle events carry no delivery outcome this application
    // acts on, and open/click tracking stays disabled at the provider.
    return {
      diagnostic: {
        eventType: payload.type,
        ignoredReason: 'unsupported-event-type',
        payloadExtraFieldNames: extraFieldNames,
      },
      event: null,
    };
  }
  const occurredAt = new Date(payload.created_at);
  const event: EmailFeedbackEvent = {
    eventType,
    providerEventId: message.id,
    providerMessageId: payload.data.email_id,
  };
  if (eventType === 'bounce') {
    event.bounceType = normalizeBounceType(payload.data.bounce?.type);
  }
  if (Number.isFinite(occurredAt.getTime())) {
    event.occurredAt = occurredAt;
  }
  return {
    diagnostic: {
      eventType: payload.type,
      ignoredReason: null,
      payloadExtraFieldNames: extraFieldNames,
    },
    event,
  };
}
