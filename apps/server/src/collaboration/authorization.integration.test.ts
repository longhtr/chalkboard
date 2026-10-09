/**
 * Uses PostgreSQL account, session, board, and membership rows to prove every
 * collaboration role and revoked/expired-session authorization result.
 */
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../db/migrate.js';
import { requiredTestValue } from '../test/assertions.js';
import {
  createCollaborationAuthorization,
  hashSessionToken,
} from './authorization.js';

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(connectionString === undefined)(
  'collaboration authorization',
  () => {
    const pool = new Pool({ connectionString });
    const authorization = createCollaborationAuthorization(pool);
    const userIds: string[] = [];
    let boardId = '';
    let ownerId = '';
    let editorId = '';
    let viewerId = '';

    async function createUser(label: string): Promise<string> {
      const email = `${label}-${crypto.randomUUID()}@example.com`;
      const result = await pool.query<{ id: string }>(
        `INSERT INTO users (
           email, email_normalized, display_name, password_hash
         ) VALUES ($1, $1, $2, 'unused')
         RETURNING id`,
        [email, label],
      );
      const id = requiredTestValue(result.rows[0], 'created user row').id;
      userIds.push(id);
      return id;
    }

    async function createSession(
      userId: string,
      token: string,
      state: 'active' | 'expired' | 'revoked' = 'active',
    ): Promise<void> {
      await pool.query(
        `INSERT INTO sessions (
           user_id, token_hash, expires_at, revoked_at
         ) VALUES (
           $1, $2,
           ${state === 'expired' ? "NOW() - INTERVAL '1 hour'" : "NOW() + INTERVAL '1 hour'"},
           ${state === 'revoked' ? 'NOW()' : 'NULL'}
         )`,
        [userId, hashSessionToken(token)],
      );
    }

    beforeAll(async () => {
      await runMigrations(pool, resolve(process.cwd(), 'migrations'));
      ownerId = await createUser('owner');
      editorId = await createUser('editor');
      viewerId = await createUser('viewer');
      const outsiderId = await createUser('outsider');
      const board = await pool.query<{ id: string }>(
        `INSERT INTO boards (title, owner_id)
         VALUES ('Authorization test', $1)
         RETURNING id`,
        [ownerId],
      );
      boardId = requiredTestValue(board.rows[0], 'created board row').id;
      await pool.query(
        `INSERT INTO board_members (board_id, user_id, role)
         VALUES ($1, $2, 'editor'), ($1, $3, 'viewer')`,
        [boardId, editorId, viewerId],
      );
      await Promise.all([
        createSession(ownerId, 'owner-token'),
        createSession(editorId, 'editor-token'),
        createSession(viewerId, 'viewer-token'),
        createSession(outsiderId, 'outsider-token'),
        createSession(ownerId, 'expired-token', 'expired'),
        createSession(ownerId, 'revoked-token', 'revoked'),
      ]);
    });

    afterAll(async () => {
      if (boardId !== '') {
        await pool.query('DELETE FROM boards WHERE id = $1', [boardId]);
      }
      if (userIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          userIds,
        ]);
      }
      await pool.end();
    });

    it('resolves owner, editor, and viewer permissions', async () => {
      await expect(
        authorization.authorize(boardId, 'owner-token'),
      ).resolves.toEqual({ isDemo: false, role: 'owner', userId: ownerId });
      await expect(
        authorization.authorize(boardId, 'editor-token'),
      ).resolves.toEqual({ isDemo: false, role: 'editor', userId: editorId });
      await expect(
        authorization.authorize(boardId, 'viewer-token'),
      ).resolves.toEqual({ isDemo: false, role: 'viewer', userId: viewerId });
    });

    it('rejects outsiders and inactive sessions', async () => {
      await expect(
        authorization.authorize(boardId, 'outsider-token'),
      ).resolves.toBeNull();
      await expect(
        authorization.authorize(boardId, 'expired-token'),
      ).resolves.toBeNull();
      await expect(
        authorization.authorize(boardId, 'revoked-token'),
      ).resolves.toBeNull();
      await expect(
        authorization.authorize(crypto.randomUUID(), 'owner-token'),
      ).resolves.toBeNull();
    });
  },
);
