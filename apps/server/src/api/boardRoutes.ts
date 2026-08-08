/**
 * Active-board HTTP protocol. Every operation resolves the session actor and
 * delegates authorization plus durable mutation to the board service.
 */
import {
  MAX_BOARD_TITLE_LENGTH,
  unicodeScalarLength,
} from '@chalkboard/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AccountService } from '../accounts/service.js';
import type { BoardService } from '../boards/service.js';
import type { OperationalMetrics } from '../operations/metrics.js';
import { authenticatedUser } from './authenticatedUser.js';

const boardSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .refine((title) => unicodeScalarLength(title) <= MAX_BOARD_TITLE_LENGTH),
});

/** Installs active-board list, creation, lookup, and rename routes. */
export function installBoardRoutes(
  app: FastifyInstance,
  {
    accounts,
    boards,
    metrics,
  }: {
    accounts: AccountService;
    boards: BoardService;
    metrics: OperationalMetrics;
  },
): void {
  app.get('/api/boards', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    return { boards: await boards.list(user.id) };
  });

  app.post('/api/boards', async (request, reply) => {
    const user = await authenticatedUser(request, reply, accounts, metrics);
    if (user === null) return;
    const parsed = boardSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'A title is required' });
    }
    return reply
      .code(201)
      .send({ board: await boards.create(user.id, parsed.data.title) });
  });

  app.get<{ Params: { id: string } }>(
    '/api/boards/:id',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const board = await boards.get(user.id, request.params.id);
      if (board === null) {
        return reply.code(404).send({ error: 'Board not found' });
      }
      return { board };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/boards/:id',
    async (request, reply) => {
      const user = await authenticatedUser(request, reply, accounts, metrics);
      if (user === null) return;
      const parsed = boardSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'A title is required' });
      }
      const board = await boards.rename(
        user.id,
        request.params.id,
        parsed.data.title,
      );
      if (board === null) {
        return reply.code(403).send({ error: 'Edit access required' });
      }
      return { board };
    },
  );
}
