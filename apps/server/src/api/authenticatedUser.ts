/**
 * Converts an opaque session cookie into the authenticated HTTP actor.
 * Route modules use this single boundary so missing, expired, and invalid
 * sessions produce the same response and authentication-failure metric.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AccountService, AccountUser } from '../accounts/service.js';
import { readSessionToken } from '../collaboration/authorization.js';
import type { OperationalMetrics } from '../operations/metrics.js';

const requestUsers = new WeakMap<FastifyRequest, Promise<AccountUser | null>>();

/** Returns the current actor or sends the standard 401 response and returns null. */
export async function authenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
  accounts: AccountService,
  metrics: OperationalMetrics,
): Promise<AccountUser | null> {
  let pendingUser = requestUsers.get(request);
  if (pendingUser === undefined) {
    const token = readSessionToken(request.headers.cookie);
    pendingUser =
      token === null ? Promise.resolve(null) : accounts.getSession(token);
    requestUsers.set(request, pendingUser);
  }
  const user = await pendingUser;
  if (user === null) {
    metrics.recordAuthenticationFailure();
    await reply.code(401).send({ error: 'Authentication required' });
  }
  return user;
}
