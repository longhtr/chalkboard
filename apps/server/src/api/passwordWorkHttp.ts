/**
 * Maps password-worker saturation into one audited HTTP response. Keeping this
 * translation here prevents registration and login from drifting in wording,
 * retry guidance, metrics, or audit fields.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { OperationalMetrics } from '../operations/metrics.js';
import { writeSecurityAuditEvent } from './audit.js';

/** Records saturation and sends the common retryable authentication response. */
export function passwordWorkOverloadResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  metrics: OperationalMetrics,
  action:
    | 'account.delete'
    | 'account.delete-authorization'
    | 'account.email-change'
    | 'account.password-change'
    | 'account.password-reset'
    | 'account.password-reset-request'
    | 'account.register'
    | 'account.verify-email'
    | 'session.login',
) {
  metrics.recordPasswordWorkOverload();
  writeSecurityAuditEvent(request, {
    action,
    outcome: 'rejected',
    reason: 'password-work-overloaded',
  });
  return reply
    .header('retry-after', '1')
    .code(503)
    .send({ error: 'Authentication capacity is busy. Try again shortly.' });
}
