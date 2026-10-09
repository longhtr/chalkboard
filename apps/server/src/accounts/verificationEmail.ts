/** Provider-neutral account-security email composition and delivery boundary. */
import { randomUUID } from 'node:crypto';

import type { EmailFailureClass, EmailFlow } from '../email/emailSecurity.js';
import type { OperationalErrorDiagnostic } from '../operations/errorDiagnostics.js';
import type { ProviderTextDiagnostic } from '../operations/providerDiagnostics.js';

export type VerificationEmailPurpose = EmailFlow;

interface VerificationEmailMessage {
  html: string;
  subject: string;
  text: string;
}

export interface VerificationEmailRequestDiagnostic {
  action: 'resend:SendEmail';
  attemptsMade: number;
  contentMode: 'simple-html-and-text';
  destinationCount: 1;
  fromMatchesConfiguredValue: true;
  idempotencyWindowHours: number;
  idempotent: true;
  maxAttempts: 2;
  replyToCount: 1;
  timeoutMilliseconds: number;
}

export interface VerificationEmailAcceptanceDiagnostic {
  providerMessageIdDiagnostic: ProviderTextDiagnostic;
  providerResponseFieldNames: string[];
  providerResponseFieldsComplete: boolean;
  providerResponseFieldsObserved: number;
  providerResponseFieldsOmitted: number;
  request: VerificationEmailRequestDiagnostic;
}

export interface VerificationEmailDelivery {
  acceptanceDiagnostic?: VerificationEmailAcceptanceDiagnostic;
  providerMessageId: string;
}

export type VerificationEmailProviderErrorName =
  | 'ApplicationError'
  | 'ConcurrentIdempotentRequest'
  | 'IdempotencyConflict'
  | 'InternalServerError'
  | 'InvalidApiKey'
  | 'InvalidFromAddress'
  | 'InvalidIdempotencyKey'
  | 'InvalidProviderResponse'
  | 'LocalConfigurationError'
  | 'LocalDestinationRestriction'
  | 'MethodNotAllowed'
  | 'MissingApiKey'
  | 'NotFound'
  | 'OtherServiceError'
  | 'QuotaExceeded'
  | 'RateLimitExceeded'
  | 'RestrictedApiKey'
  | 'SecurityError'
  | 'TransportError'
  | 'UnclassifiedError'
  | 'ValidationError';

export interface VerificationEmailFailureDiagnostic {
  certainty: 'ambiguous' | 'rejected';
  failureClass: EmailFailureClass;
  httpStatusCode: number | null;
  /**
   * The provider's own error vocabulary, retained only when it matches a known
   * documented value so an unexpected string cannot become log content.
   */
  providerErrorType: string | null;
  providerErrorName: VerificationEmailProviderErrorName;
  providerFault: 'client' | 'server' | null;
  /**
   * Fingerprint and size of the provider's message. The prose is deliberately
   * omitted: refusal text can quote the recipient address.
   */
  providerMessageDiagnostic: ProviderTextDiagnostic | null;
  providerOperationalError: OperationalErrorDiagnostic | null;
  providerResponseFieldNames: string[];
  request: VerificationEmailRequestDiagnostic | null;
}

interface RequiredProviderFailure {
  certainty: VerificationEmailFailureDiagnostic['certainty'];
  failureClass: EmailFailureClass;
  httpStatusCode: number | null;
  providerErrorName: VerificationEmailProviderErrorName;
}

type OptionalProviderEvidence = Omit<
  VerificationEmailFailureDiagnostic,
  keyof RequiredProviderFailure
>;

export class VerificationEmailDeliveryError extends Error {
  readonly certainty: VerificationEmailFailureDiagnostic['certainty'];
  readonly failureClass: EmailFailureClass;
  readonly httpStatusCode: number | null;
  readonly providerErrorName: VerificationEmailProviderErrorName;
  readonly providerErrorType: string | null;
  readonly providerFault: 'client' | 'server' | null;
  readonly providerMessageDiagnostic: ProviderTextDiagnostic | null;
  readonly providerOperationalError: OperationalErrorDiagnostic | null;
  readonly providerResponseFieldNames: string[];
  readonly request: VerificationEmailRequestDiagnostic | null;

  constructor(
    message: string,
    options: RequiredProviderFailure &
      Partial<OptionalProviderEvidence> & { cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'VerificationEmailDeliveryError';
    this.certainty = options.certainty;
    this.failureClass = options.failureClass;
    this.httpStatusCode = options.httpStatusCode;
    this.providerErrorName = options.providerErrorName;
    this.providerErrorType = options.providerErrorType ?? null;
    this.providerFault = options.providerFault ?? null;
    this.providerMessageDiagnostic = options.providerMessageDiagnostic ?? null;
    this.providerOperationalError = options.providerOperationalError ?? null;
    this.providerResponseFieldNames = options.providerResponseFieldNames ?? [];
    this.request = options.request ?? null;
  }

  diagnostic(): VerificationEmailFailureDiagnostic {
    return {
      certainty: this.certainty,
      failureClass: this.failureClass,
      httpStatusCode: this.httpStatusCode,
      providerErrorName: this.providerErrorName,
      providerErrorType: this.providerErrorType,
      providerFault: this.providerFault,
      providerMessageDiagnostic: this.providerMessageDiagnostic,
      providerOperationalError: this.providerOperationalError,
      providerResponseFieldNames: this.providerResponseFieldNames,
      request: this.request,
    };
  }
}

export interface VerificationEmailSender {
  close(): void;
  send(input: {
    code: string;
    intentId: string;
    purpose: VerificationEmailPurpose;
    to: string;
  }): Promise<VerificationEmailDelivery>;
}

export interface DevelopmentEmail {
  createdAt: string;
  html: string;
  id: string;
  purpose: VerificationEmailPurpose;
  subject: string;
  text: string;
  to: string;
}

export interface DevelopmentEmailInbox {
  list(): readonly DevelopmentEmail[];
}

const GENERIC_SUBJECTS: Record<VerificationEmailPurpose, string> = {
  registration: 'Confirm your Chalkboard account',
  'password-reset': 'Reset your Chalkboard password',
  'email-change': 'Confirm your Chalkboard email change',
};

const ACTION_DESCRIPTIONS: Record<VerificationEmailPurpose, string> = {
  registration: 'finish creating your Chalkboard account',
  'password-reset': 'reset your Chalkboard password',
  'email-change': 'confirm the new email address for your Chalkboard account',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Builds one branded message with a generic subject and code only in its body. */
export function verificationEmailMessage(
  purpose: VerificationEmailPurpose,
  code: string,
): VerificationEmailMessage {
  const subject = GENERIC_SUBJECTS[purpose];
  const action = ACTION_DESCRIPTIONS[purpose];
  const text = [
    'Chalkboard',
    '',
    `Use this code to ${action}:`,
    '',
    code,
    '',
    'This code expires in 15 minutes.',
    'If you did not request this action, ignore this message. Do not share the code.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f1e8;color:#1f2937;font-family:Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <div style="background:#fff;border:1px solid #d6d3c8;border-radius:12px;padding:28px">
        <h1 style="font-size:22px;margin:0 0 20px">Chalkboard</h1>
        <p style="line-height:1.5">Use this code to ${escapeHtml(action)}:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:0.12em;margin:24px 0">${escapeHtml(code)}</p>
        <p style="line-height:1.5">This code expires in 15 minutes.</p>
        <p style="line-height:1.5">If you did not request this action, ignore this message. Do not share the code.</p>
      </div>
    </div>
  </body>
</html>`;
  return { html, subject, text };
}

/** Fail-closed sender used when production delivery configuration is unavailable. */
export function createUnavailableVerificationEmailSender(): VerificationEmailSender {
  return {
    close() {},
    async send() {
      throw new VerificationEmailDeliveryError(
        'Email delivery is temporarily unavailable',
        {
          certainty: 'rejected',
          failureClass: 'configuration',
          httpStatusCode: null,
          providerErrorName: 'LocalConfigurationError',
        },
      );
    },
  };
}

/** In-memory development sender exposed only through localhost development routes. */
export function createDevelopmentVerificationEmailSender(): {
  inbox: DevelopmentEmailInbox;
  sender: VerificationEmailSender;
} {
  const messages: DevelopmentEmail[] = [];
  return {
    inbox: { list: () => messages.map((message) => ({ ...message })) },
    sender: {
      close() {
        messages.length = 0;
      },
      async send({ code, purpose, to }) {
        if (!to.toLocaleLowerCase('en-US').endsWith('@chalkboard.test')) {
          throw new VerificationEmailDeliveryError(
            'Development email must use the chalkboard.test domain',
            {
              certainty: 'rejected',
              failureClass: 'destination',
              httpStatusCode: null,
              providerErrorName: 'LocalDestinationRestriction',
            },
          );
        }
        const message = verificationEmailMessage(purpose, code);
        const id = randomUUID();
        messages.unshift({
          ...message,
          createdAt: new Date().toISOString(),
          id,
          purpose,
          to,
        });
        if (messages.length > 20) messages.length = 20;
        return { providerMessageId: `development:${id}` };
      },
    },
  };
}
