/** Writes bounded account-email provider diagnostics without recipient or message data. */
import type { FastifyBaseLogger } from 'fastify';

import type {
  AccountEmailBookkeepingFailureDiagnostic,
  AccountEmailDeliveryFailureDiagnostic,
} from './workflows.js';

/** Logs complete accepted-send reconciliation evidence after bookkeeping failure. */
export function logAccountEmailBookkeepingFailure(
  log: Pick<FastifyBaseLogger, 'error'>,
  diagnostic: AccountEmailBookkeepingFailureDiagnostic,
): void {
  log.error(
    { accountEmailBookkeepingFailure: diagnostic },
    'Account email bookkeeping failed',
  );
}

/** Logs only the adapter-sanitized failure classification. */
export function logAccountEmailDeliveryFailure(
  log: Pick<FastifyBaseLogger, 'warn'>,
  diagnostic: AccountEmailDeliveryFailureDiagnostic,
): void {
  log.warn(
    {
      accountEmailDeliveryFailure: diagnostic,
    },
    'Account email delivery failed',
  );
}
