/**
 * Emits security decisions as structured, content-free events. Audit records
 * identify the action and authorized identifiers but never include passwords,
 * session cookies, invitation tokens, board content, or request bodies.
 */
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';

type SecurityAuditAction =
  | 'account.delete'
  | 'account.delete-authorization'
  | 'account.display-name-change'
  | 'account.email-change'
  | 'account.email-change-code'
  | 'account.password-change'
  | 'account.password-reset'
  | 'account.password-reset-request'
  | 'account.register'
  | 'account.registration-request'
  | 'account.verify-email'
  | 'board.delete'
  | 'board.delete-all-permanently'
  | 'board.delete-permanently'
  | 'board.restore'
  | 'board.restore-all'
  | 'invite-link.create'
  | 'invite-link.redeem'
  | 'invite-link.revoke'
  | 'membership.add'
  | 'membership.remove'
  | 'membership.role-change'
  | 'session.login'
  | 'session.logout';

interface SecurityAuditEvent {
  action: SecurityAuditAction;
  actorUserId?: string;
  boardId?: string;
  outcome: 'rejected' | 'succeeded';
  reason?:
    | 'conflict'
    | 'invalid-credentials'
    | 'invalid-input'
    | 'not-authorized'
    | 'not-found-or-expired'
    | 'password-work-overloaded'
    | 'rate-limited';
  role?: 'editor' | 'owner' | 'viewer';
  subjectUserId?: string;
}

interface AuditRequest {
  id: FastifyRequest['id'];
  ip: string;
  log: FastifyBaseLogger;
}

/** Writes one sanitized security decision through the request-scoped logger. */
export function writeSecurityAuditEvent(
  request: AuditRequest,
  event: SecurityAuditEvent,
): void {
  request.log.info(
    {
      audit: {
        ...event,
        requestId: request.id,
        sourceIp: request.ip,
      },
    },
    'Security audit event',
  );
}
