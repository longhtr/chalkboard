/**
 * HTTP protocol for expiring board invitations. Only token hashes enter
 * PostgreSQL; the bearer token is returned once, delivered in a URL fragment,
 * and exchanged by an authenticated account.
 */
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import type { AccountService } from '../accounts/service.js';
import type { BoardService } from '../boards/service.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { writeSecurityAuditEvent } from './audit.js';
import { authenticatedUser } from './authenticatedUser.js';
import { createRateLimiter } from './security.js';

const roleSchema = z.object({ role: z.enum(['editor', 'viewer']) });
const tokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const INVITE_LINK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** Installs owner-managed invitation creation, listing, revocation, and redemption. */
export function installBoardInviteRoutes(
  app: FastifyInstance,
  {
    accounts,
    boards,
    collaboration,
    metrics,
  }: {
    accounts: AccountService;
    boards: BoardService;
    collaboration: Pick<CollaborationGatewayControl, 'invalidateBoard'>;
    metrics: OperationalMetrics;
  },
): void {
  const limit = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });

  app.get<{ Params: { id: string } }>(
    '/api/boards/:id/invite-links',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const links = await boards.listInviteLinks(user.id, request.params.id);
      if (links === null)
        return reply.code(403).send({ error: 'Owner access required' });
      return { links };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/boards/:id/invite-links',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const rate = limit(`invite:${user.id}`);
      if (!rate.allowed)
        return reply
          .header('retry-after', String(rate.retryAfterSeconds))
          .code(429)
          .send({ error: 'Too many sharing changes. Try again later.' });
      const parsed = roleSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: 'Invalid role' });
      const token = randomBytes(32).toString('base64url');
      const link = await boards.createInviteLink(
        user.id,
        request.params.id,
        parsed.data.role,
        tokenHash(token),
        new Date(Date.now() + INVITE_LINK_LIFETIME_MS),
      );
      if (link === null)
        return reply.code(403).send({ error: 'Owner access required' });
      writeSecurityAuditEvent(request, {
        action: 'invite-link.create',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
        role: parsed.data.role,
      });
      return reply.code(201).send({ link, token });
    },
  );

  app.delete<{ Params: { id: string; inviteId: string } }>(
    '/api/boards/:id/invite-links/:inviteId',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      if (
        !(await boards.revokeInviteLink(
          user.id,
          request.params.id,
          request.params.inviteId,
        ))
      )
        return reply.code(403).send({ error: 'Owner access required' });
      writeSecurityAuditEvent(request, {
        action: 'invite-link.revoke',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
      });
      return reply.code(204).send();
    },
  );

  app.post('/api/board-invites/redeem', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    const rate = limit(`invite:${user.id}`);
    if (!rate.allowed)
      return reply
        .header('retry-after', String(rate.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many sharing attempts. Try again later.' });
    const parsed = tokenSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'Invalid invitation link' });
    const board = await boards.redeemInviteLink(
      user.id,
      tokenHash(parsed.data.token),
    );
    if (board === null) {
      writeSecurityAuditEvent(request, {
        action: 'invite-link.redeem',
        actorUserId: user.id,
        outcome: 'rejected',
        reason: 'not-found-or-expired',
      });
      return reply
        .code(404)
        .send({ error: 'Invitation link is invalid, expired, or revoked' });
    }
    writeSecurityAuditEvent(request, {
      action: 'invite-link.redeem',
      actorUserId: user.id,
      boardId: board.id,
      outcome: 'succeeded',
      role: board.role,
    });
    collaboration.invalidateBoard(board.id);
    return { board };
  });
}
