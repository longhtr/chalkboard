/**
 * Owner-only membership HTTP protocol. Successful mutations invalidate the
 * board's live room so connected clients cannot retain revoked authority.
 */
import { MAX_ACCOUNT_EMAIL_LENGTH } from '@chalkboard/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AccountService } from '../accounts/service.js';
import type { BoardService } from '../boards/service.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { writeSecurityAuditEvent } from './audit.js';
import { authenticatedUser } from './authenticatedUser.js';
import { createRateLimiter } from './security.js';

const memberRoleSchema = z.object({ role: z.enum(['editor', 'viewer']) });
const newMemberSchema = memberRoleSchema.extend({
  email: z.email().max(MAX_ACCOUNT_EMAIL_LENGTH),
});

/** Installs owner-authorized board membership routes. */
export function installMemberRoutes(
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
  const limitSharing = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });

  app.get<{ Params: { id: string } }>(
    '/api/boards/:id/members',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const members = await boards.listMembers(user.id, request.params.id);
      if (members === null) {
        return reply.code(403).send({ error: 'Owner access required' });
      }
      return { members };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/boards/:id/members',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const rate = limitSharing(`sharing:${user.id}`);
      if (!rate.allowed) {
        return reply
          .header('retry-after', String(rate.retryAfterSeconds))
          .code(429)
          .send({ error: 'Too many sharing changes. Try again later.' });
      }
      const parsed = newMemberSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'A valid account email and role are required' });
      }
      const member = await boards.addMember(
        user.id,
        request.params.id,
        parsed.data.email,
        parsed.data.role,
      );
      if (member === null) {
        writeSecurityAuditEvent(request, {
          action: 'membership.add',
          actorUserId: user.id,
          boardId: request.params.id,
          outcome: 'rejected',
          reason: 'not-authorized',
          role: parsed.data.role,
        });
        return reply.code(404).send({ error: 'Account or board not found' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.add',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
        role: parsed.data.role,
        subjectUserId: member.userId,
      });
      collaboration.invalidateBoard(request.params.id);
      return reply.code(201).send({ member });
    },
  );

  app.patch<{ Params: { id: string; userId: string } }>(
    '/api/boards/:id/members/:userId',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const parsed = memberRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid role' });
      }
      const member = await boards.updateMember(
        user.id,
        request.params.id,
        request.params.userId,
        parsed.data.role,
      );
      if (member === null) {
        writeSecurityAuditEvent(request, {
          action: 'membership.role-change',
          actorUserId: user.id,
          boardId: request.params.id,
          outcome: 'rejected',
          reason: 'not-authorized',
          role: parsed.data.role,
          subjectUserId: request.params.userId,
        });
        return reply.code(403).send({ error: 'Owner access required' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.role-change',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
        role: parsed.data.role,
        subjectUserId: member.userId,
      });
      collaboration.invalidateBoard(request.params.id);
      return { member };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/boards/:id/members/:userId',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      if (
        !(await boards.removeMember(
          user.id,
          request.params.id,
          request.params.userId,
        ))
      ) {
        writeSecurityAuditEvent(request, {
          action: 'membership.remove',
          actorUserId: user.id,
          boardId: request.params.id,
          outcome: 'rejected',
          reason: 'not-authorized',
          subjectUserId: request.params.userId,
        });
        return reply.code(403).send({ error: 'Owner access required' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.remove',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
        subjectUserId: request.params.userId,
      });
      collaboration.invalidateBoard(request.params.id);
      return reply.code(204).send();
    },
  );
}
