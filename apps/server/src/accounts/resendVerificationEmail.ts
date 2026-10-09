/** Resend REST delivery with an idempotent, bounded single retry. */
import {
  VerificationEmailDeliveryError,
  verificationEmailMessage,
  type VerificationEmailRequestDiagnostic,
  type VerificationEmailDelivery,
  type VerificationEmailProviderErrorName,
  type VerificationEmailSender,
} from './verificationEmail.js';
import type { EmailFailureClass } from '../email/emailSecurity.js';
import {
  diagnosePrivateProviderText,
  diagnoseProviderOperationalError,
  type ProviderTextDiagnostic,
} from '../operations/providerDiagnostics.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_SEND_TIMEOUT_MS = 10_000;
const RESEND_RETRY_DELAY_MS = 250;
const MAX_RESPONSE_BYTES = 16 * 1_024;
/** The provider retains an idempotency key for 24 hours. */
const IDEMPOTENCY_WINDOW_HOURS = 24;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

export interface ResendVerificationEmailConfiguration {
  apiKey: string;
  from: string;
  replyTo: string;
}

const DOCUMENTED_ERROR_TYPES = new Set([
  'application_error',
  'concurrent_idempotent_requests',
  'daily_quota_exceeded',
  'internal_server_error',
  'invalid_access',
  'invalid_api_key',
  'invalid_attachment',
  'invalid_from_address',
  'invalid_idempotency_key',
  'invalid_idempotent_request',
  'invalid_parameter',
  'invalid_region',
  'method_not_allowed',
  'missing_api_key',
  'missing_required_field',
  'monthly_quota_exceeded',
  'not_found',
  'rate_limit_exceeded',
  'restricted_api_key',
  'security_error',
  'validation_error',
]);

interface Classification {
  certainty: 'ambiguous' | 'rejected';
  failureClass: EmailFailureClass;
  providerErrorName: VerificationEmailProviderErrorName;
  /** Only an ambiguous outcome may be retried under the same key. */
  retryable: boolean;
}

/**
 * Maps the documented provider error vocabulary onto the application's failure
 * classes. `ambiguous` is reserved for outcomes that may already have accepted
 * the message: a refusal the provider states explicitly is always `rejected`,
 * so the pending code is cancelled rather than left outstanding.
 */
function classifyResponse(
  status: number,
  errorType: string | null,
): Classification {
  if (status >= 500) {
    return {
      certainty: 'ambiguous',
      failureClass: 'transport',
      providerErrorName:
        errorType === 'application_error'
          ? 'ApplicationError'
          : 'InternalServerError',
      retryable: true,
    };
  }
  switch (errorType) {
    case 'concurrent_idempotent_requests':
      // A request under this key is still in flight, so its outcome is unknown
      // and a second attempt would race the first.
      return {
        certainty: 'ambiguous',
        failureClass: 'transport',
        providerErrorName: 'ConcurrentIdempotentRequest',
        retryable: false,
      };
    case 'invalid_idempotent_request':
      return {
        certainty: 'rejected',
        failureClass: 'configuration',
        providerErrorName: 'IdempotencyConflict',
        retryable: false,
      };
    case 'invalid_idempotency_key':
      return {
        certainty: 'rejected',
        failureClass: 'configuration',
        providerErrorName: 'InvalidIdempotencyKey',
        retryable: false,
      };
    case 'daily_quota_exceeded':
    case 'monthly_quota_exceeded':
      return {
        certainty: 'rejected',
        failureClass: 'provider-rejection',
        providerErrorName: 'QuotaExceeded',
        retryable: false,
      };
    case 'rate_limit_exceeded':
      return {
        certainty: 'rejected',
        failureClass: 'transport',
        providerErrorName: 'RateLimitExceeded',
        retryable: false,
      };
    case 'security_error':
      return {
        certainty: 'rejected',
        failureClass: 'provider-rejection',
        providerErrorName: 'SecurityError',
        retryable: false,
      };
    case 'invalid_api_key':
    case 'missing_api_key':
    case 'restricted_api_key':
      return {
        certainty: 'rejected',
        failureClass: 'configuration',
        providerErrorName:
          errorType === 'invalid_api_key'
            ? 'InvalidApiKey'
            : errorType === 'missing_api_key'
              ? 'MissingApiKey'
              : 'RestrictedApiKey',
        retryable: false,
      };
    case 'invalid_from_address':
      return {
        certainty: 'rejected',
        failureClass: 'configuration',
        providerErrorName: 'InvalidFromAddress',
        retryable: false,
      };
    case 'method_not_allowed':
    case 'not_found':
      return {
        certainty: 'rejected',
        failureClass: 'configuration',
        providerErrorName:
          errorType === 'not_found' ? 'NotFound' : 'MethodNotAllowed',
        retryable: false,
      };
    case 'invalid_access':
    case 'invalid_attachment':
    case 'invalid_parameter':
    case 'invalid_region':
    case 'missing_required_field':
      return {
        certainty: 'rejected',
        failureClass: 'configuration',
        providerErrorName: 'ValidationError',
        retryable: false,
      };
    case 'validation_error':
      // A 403 validation error is an unverified or unclaimed sending domain,
      // which is local configuration rather than a per-message refusal.
      return {
        certainty: 'rejected',
        failureClass: status === 403 ? 'configuration' : 'provider-rejection',
        providerErrorName: 'ValidationError',
        retryable: false,
      };
    default:
      return {
        certainty: 'rejected',
        failureClass: status === 429 ? 'transport' : 'provider-rejection',
        providerErrorName: 'OtherServiceError',
        retryable: false,
      };
  }
}

/** Retains equality and size for the identifier without exposing its value. */
function diagnosePrivateProviderMessageId(id: string): ProviderTextDiagnostic {
  return diagnosePrivateProviderText(
    id,
    'Accepted provider message identifier omitted',
  );
}

function responseFieldNames(parsed: unknown): string[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  try {
    return Object.keys(parsed)
      .slice(0, 64)
      .map((name) =>
        /^[A-Za-z0-9_$.-]{1,128}$/u.test(name) ? name : '[private-field]',
      );
  } catch {
    return [];
  }
}

function requestDiagnostic(
  attemptsMade: number,
): VerificationEmailRequestDiagnostic {
  return {
    action: 'resend:SendEmail',
    attemptsMade,
    contentMode: 'simple-html-and-text',
    destinationCount: 1,
    fromMatchesConfiguredValue: true,
    idempotencyWindowHours: IDEMPOTENCY_WINDOW_HOURS,
    idempotent: true,
    maxAttempts: 2,
    replyToCount: 1,
    timeoutMilliseconds: RESEND_SEND_TIMEOUT_MS,
  };
}

async function readBoundedText(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        chunks.push(
          value.subarray(0, value.byteLength - (total - MAX_RESPONSE_BYTES)),
        );
        break;
      }
      chunks.push(value);
    }
  } finally {
    // A cancelled read must never mask the provider outcome being classified.
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function errorTypeOf(text: string): {
  message: string | null;
  type: string | null;
} {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) {
      return { message: null, type: null };
    }
    const record = parsed as Record<string, unknown>;
    return {
      message: typeof record['message'] === 'string' ? record['message'] : null,
      type:
        typeof record['name'] === 'string'
          ? record['name']
          : typeof record['error'] === 'string'
            ? record['error']
            : null,
    };
  } catch {
    return { message: null, type: null };
  }
}

/**
 * Creates Resend delivery. At most two HTTP attempts are made and both carry
 * the same durable intent identifier as the idempotency key, so a retry after
 * an ambiguous transport failure cannot deliver a second message: the provider
 * replays the stored result of the first attempt instead.
 */
export function createResendVerificationEmailSender(
  configuration: ResendVerificationEmailConfiguration,
  options: { fetchImplementation?: typeof fetch; retryDelayMs?: number } = {},
): VerificationEmailSender {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? RESEND_RETRY_DELAY_MS;

  return {
    close() {},
    async send({
      code,
      intentId,
      purpose,
      to,
    }): Promise<VerificationEmailDelivery> {
      if (
        intentId.length === 0 ||
        intentId.length > MAX_IDEMPOTENCY_KEY_LENGTH
      ) {
        throw new VerificationEmailDeliveryError(
          'Email delivery intent identifier cannot key an idempotent send',
          {
            certainty: 'rejected',
            failureClass: 'configuration',
            httpStatusCode: null,
            providerErrorName: 'LocalConfigurationError',
          },
        );
      }
      const { html, subject, text } = verificationEmailMessage(purpose, code);
      const payload = JSON.stringify({
        from: configuration.from,
        html,
        reply_to: configuration.replyTo,
        subject,
        text,
        to: [to],
      });

      let lastFailure: VerificationEmailDeliveryError | null = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        let response: Response;
        let body: string;
        try {
          response = await fetchImplementation(RESEND_ENDPOINT, {
            body: payload,
            headers: {
              authorization: `Bearer ${configuration.apiKey}`,
              'content-type': 'application/json',
              'idempotency-key': intentId,
            },
            method: 'POST',
            signal: AbortSignal.timeout(RESEND_SEND_TIMEOUT_MS),
          });
          // The body read is inside this boundary deliberately. A connection
          // that drops after the headers arrive leaves acceptance just as
          // unknown as one that never connected, and is entitled to the same
          // single idempotent retry.
          body = await readBoundedText(response);
        } catch (error) {
          // Transport failure leaves acceptance unknown. The identical key makes
          // exactly one further attempt safe inside the provider's window.
          lastFailure = new VerificationEmailDeliveryError(
            'Email delivery transport failed',
            {
              cause: error,
              certainty: 'ambiguous',
              failureClass: 'transport',
              httpStatusCode: null,
              providerErrorName: 'TransportError',
              providerOperationalError: diagnoseProviderOperationalError(error),
              request: requestDiagnostic(attempt),
            },
          );
          if (attempt === 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            continue;
          }
          throw lastFailure;
        }

        if (response.ok) {
          const parsed: unknown = (() => {
            try {
              return JSON.parse(body);
            } catch {
              return null;
            }
          })();
          const id =
            typeof parsed === 'object' && parsed !== null
              ? (parsed as Record<string, unknown>)['id']
              : undefined;
          if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
            // Without a usable identifier no later feedback event can be matched
            // to this intent, so acceptance cannot be recorded as known.
            throw new VerificationEmailDeliveryError(
              'Email provider returned an unusable acceptance response',
              {
                certainty: 'ambiguous',
                failureClass: 'unknown',
                httpStatusCode: response.status,
                providerErrorName: 'InvalidProviderResponse',
                request: requestDiagnostic(attempt),
              },
            );
          }
          const fieldNames = responseFieldNames(parsed);
          return {
            acceptanceDiagnostic: {
              providerMessageIdDiagnostic: diagnosePrivateProviderMessageId(id),
              providerResponseFieldNames: fieldNames,
              providerResponseFieldsComplete: true,
              providerResponseFieldsObserved: fieldNames.length,
              providerResponseFieldsOmitted: 0,
              request: requestDiagnostic(attempt),
            },
            providerMessageId: id,
          };
        }

        const { message, type } = errorTypeOf(body);
        const classification = classifyResponse(response.status, type);
        lastFailure = new VerificationEmailDeliveryError(
          'Email provider refused the delivery',
          {
            certainty: classification.certainty,
            failureClass: classification.failureClass,
            httpStatusCode: response.status,
            providerErrorName: classification.providerErrorName,
            providerErrorType: DOCUMENTED_ERROR_TYPES.has(type ?? '')
              ? type
              : null,
            providerFault: response.status >= 500 ? 'server' : 'client',
            // Refusal prose can quote the recipient address, so only its
            // fingerprint and size are retained.
            providerMessageDiagnostic:
              message === null
                ? null
                : diagnosePrivateProviderText(
                    message,
                    'Provider refusal message omitted',
                  ),
            request: requestDiagnostic(attempt),
          },
        );
        if (classification.retryable && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        throw lastFailure;
      }
      /* c8 ignore next 2 -- the loop either returns or throws on both attempts */
      throw lastFailure ?? new Error('Email delivery ended without an outcome');
    },
  };
}
