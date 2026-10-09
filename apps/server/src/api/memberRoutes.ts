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
      const shared = await boards.inviteMember(
        user.id,
        request.params.id,
        parsed.data.email,
        parsed.data.role,
      );
      if (shared === null) {
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
      if (shared.kind === 'member') {
        writeSecurityAuditEvent(request, {
          action: 'membership.add',
          actorUserId: user.id,
          boardId: request.params.id,
          outcome: 'succeeded',
          role: parsed.data.role,
          subjectUserId: shared.member.userId,
        });
        // A role change revisits who may open the board.
        collaboration.invalidateBoard(request.params.id);
        return reply.code(200).send({ member: shared.member });
      }
      if (shared.kind === 'refused') {
        writeSecurityAuditEvent(request, {
          action: 'membership.invite',
          actorUserId: user.id,
          boardId: request.params.id,
          outcome: 'rejected',
          reason: 'not-authorized',
          role: parsed.data.role,
        });
        return reply
          .code(409)
          .send({ error: 'That person does not accept new invites.' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.invite',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
        role: parsed.data.role,
      });
      // The offer grants nothing, so no admission decision changes. It does
      // change what every session watching this board's access should see.
      collaboration.invalidateBoard(request.params.id);
      return reply.code(201).send({ invitation: shared.invitation });
    },
  );

  // What the owner can see and undo about offers nobody has answered yet.
  app.get<{ Params: { id: string } }>(
    '/api/boards/:id/invitations',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const invitations = await boards.listBoardInvitations(
        user.id,
        request.params.id,
      );
      if (invitations === null) {
        return reply.code(403).send({ error: 'Owner access required' });
      }
      return { invitations };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/boards/:id/invitations/:userId',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const withdrawn = await boards.withdrawInvitation(
        user.id,
        request.params.id,
        request.params.userId,
      );
      if (!withdrawn) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.invitation-withdraw',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
        subjectUserId: request.params.userId,
      });
      // Another session of the owner's may be watching the same board.
      collaboration.invalidateBoard(request.params.id);
      return reply.code(204).send();
    },
  );

  // Leaving a board you joined. Owner-authorized routes cannot express this:
  // the person acting is the subject, and the owner has no say in it.
  app.delete<{ Params: { id: string } }>(
    '/api/boards/:id/membership',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const left = await boards.leave(user.id, request.params.id);
      if (!left) {
        return reply.code(404).send({ error: 'Membership not found' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.leave',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
      });
      collaboration.invalidateBoard(request.params.id);
      return reply.code(204).send();
    },
  );

  // The invitee's own side of sharing. These are the only membership routes
  // that are not owner-authorized, because the person answering an invitation
  // is by definition not yet a member of the board it offers.
  app.get('/api/board-invitations', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    return { invitations: await boards.listInvitations(user.id) };
  });

  app.post<{ Params: { boardId: string } }>(
    '/api/board-invitations/:boardId/accept',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const accepted = await boards.acceptInvitation(
        user.id,
        request.params.boardId,
      );
      if (!accepted) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.invitation-accept',
        actorUserId: user.id,
        boardId: request.params.boardId,
        outcome: 'succeeded',
      });
      // Accepting is the moment access begins, so this is where the gateway
      // has to reconsider who may open the board.
      collaboration.invalidateBoard(request.params.boardId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { boardId: string } }>(
    '/api/board-invitations/:boardId/reject',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const rejected = await boards.rejectInvitation(
        user.id,
        request.params.boardId,
      );
      if (!rejected) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }
      writeSecurityAuditEvent(request, {
        action: 'membership.invitation-reject',
        actorUserId: user.id,
        boardId: request.params.boardId,
        outcome: 'succeeded',
      });
      // Declining grants nothing, so no admission decision changes. The owner
      // is still watching an offer that no longer exists, and this is the
      // signal that reaches them.
      collaboration.invalidateBoard(request.params.boardId);
      return reply.code(204).send();
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
