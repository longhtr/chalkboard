/**
 * HTTP protocol for board trash. The board service performs durable ownership
 * checks; successful restore and deletion operations invalidate any in-memory
 * collaboration room whose authority or existence changed.
 */
import type { FastifyInstance } from 'fastify';

import type { AccountService } from '../accounts/service.js';
import type { BoardService } from '../boards/service.js';
import type { CollaborationGatewayControl } from '../collaboration/gateway.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { writeSecurityAuditEvent } from './audit.js';
import { authenticatedUser } from './authenticatedUser.js';

/** Installs authorized list, restore, and permanent-deletion trash routes. */
export function installBoardTrashRoutes(
  app: FastifyInstance,
  options: {
    accounts: AccountService;
    boards: BoardService;
    collaboration: Pick<CollaborationGatewayControl, 'invalidateBoard'>;
    metrics: OperationalMetrics;
  },
): void {
  const { accounts, boards, collaboration, metrics } = options;

  app.get('/api/boards/trash', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    return { boards: await boards.listTrash(user.id) };
  });

  app.post('/api/boards/trash/restore-all', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    const restoredIds = await boards.restoreAll(user.id);
    for (const boardId of restoredIds) collaboration.invalidateBoard(boardId);
    writeSecurityAuditEvent(request, {
      action: 'board.restore-all',
      actorUserId: user.id,
      outcome: 'succeeded',
    });
    return { restored: restoredIds.length };
  });

  app.delete('/api/boards/trash', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    const deletedIds = await boards.deleteAllPermanently(user.id);
    for (const boardId of deletedIds) collaboration.invalidateBoard(boardId);
    writeSecurityAuditEvent(request, {
      action: 'board.delete-all-permanently',
      actorUserId: user.id,
      outcome: 'succeeded',
    });
    return { deleted: deletedIds.length };
  });

  app.post<{ Params: { id: string } }>(
    '/api/boards/:id/restore',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      if (!(await boards.restore(user.id, request.params.id))) {
        return reply.code(404).send({ error: 'Trashed board not found' });
      }
      writeSecurityAuditEvent(request, {
        action: 'board.restore',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
      });
      collaboration.invalidateBoard(request.params.id);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/boards/:id/permanent',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      if (!(await boards.deletePermanently(user.id, request.params.id))) {
        return reply.code(404).send({ error: 'Trashed board not found' });
      }
      writeSecurityAuditEvent(request, {
        action: 'board.delete-permanently',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
      });
      collaboration.invalidateBoard(request.params.id);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/boards/:id',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      if (!(await boards.remove(user.id, request.params.id))) {
        writeSecurityAuditEvent(request, {
          action: 'board.delete',
          actorUserId: user.id,
          boardId: request.params.id,
          outcome: 'rejected',
          reason: 'not-authorized',
        });
        return reply.code(403).send({ error: 'Owner access required' });
      }
      writeSecurityAuditEvent(request, {
        action: 'board.delete',
        actorUserId: user.id,
        boardId: request.params.id,
        outcome: 'succeeded',
      });
      collaboration.invalidateBoard(request.params.id);
      return reply.code(204).send();
    },
  );
}
