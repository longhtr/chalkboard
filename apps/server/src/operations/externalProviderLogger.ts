/** Emits complete adapter-sanitized Turnstile and DNS provider diagnostics. */
import type { FastifyBaseLogger } from 'fastify';

import type { EmailAddressValidationFailureDiagnostic } from '../email/addressValidation.js';
import type { HumanVerificationFailureDiagnostic } from '../humanVerification/humanVerifier.js';

/** Logs one DNS resolver failure without a queried domain or address. */
export function logDnsProviderFailure(
  log: Pick<FastifyBaseLogger, 'warn'>,
  diagnostic: EmailAddressValidationFailureDiagnostic,
): void {
  log.warn(
    { emailAddressValidationFailure: diagnostic },
    'Email address DNS validation was unavailable',
  );
}

/** Logs one Turnstile failure without a token, secret, hostname, or raw body. */
export function logTurnstileProviderFailure(
  log: Pick<FastifyBaseLogger, 'warn'>,
  diagnostic: HumanVerificationFailureDiagnostic,
): void {
  log.warn(
    { humanVerificationFailure: diagnostic },
    'Human verification failed',
  );
}
