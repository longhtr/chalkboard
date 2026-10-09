/**
 * Uses PostgreSQL to prove Yjs append sequencing, consistent load, bounded
 * snapshot compaction, and deletion of only the update tail covered by it.
 */
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { runMigrations } from '../db/migrate.js';
import { requiredTestValue } from '../test/assertions.js';
import { createCollaborationPersistence } from './persistence.js';

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(connectionString === undefined)(
  'collaboration persistence',
  () => {
    const pool = new Pool({ connectionString });
    const persistence = createCollaborationPersistence(pool);
    let userId = '';
    let boardId = '';

    beforeAll(async () => {
      await runMigrations(pool, resolve(process.cwd(), 'migrations'));
      const suffix = crypto.randomUUID();
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (
           email, email_normalized, display_name, password_hash
         ) VALUES ($1, $1, 'Persistence test', 'unused')
         RETURNING id`,
        [`persistence-${suffix}@example.com`],
      );
      userId = requiredTestValue(user.rows[0], 'persistence-test user row').id;
      const board = await pool.query<{ id: string }>(
        `INSERT INTO boards (title, owner_id)
         VALUES ('Persistence test', $1)
         RETURNING id`,
        [userId],
      );
      boardId = requiredTestValue(
        board.rows[0],
        'persistence-test board row',
      ).id;
    });

    afterAll(async () => {
      if (boardId !== '') {
        await pool.query('DELETE FROM boards WHERE id = $1', [boardId]);
      }
      if (userId !== '') {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      }
      await pool.end();
    });

    it('loads one consistent snapshot while compaction commits concurrently', async () => {
      const board = await pool.query<{ id: string }>(
        `INSERT INTO boards (title, owner_id)
         VALUES ('Concurrent load test', $1)
         RETURNING id`,
        [userId],
      );
      const concurrentBoardId = requiredTestValue(
        board.rows[0],
        'concurrent-load board row',
      ).id;
      try {
        const source = new Y.Doc();
        const updates: Uint8Array[] = [];
        source.on('update', (update) => updates.push(update));
        source.getText('content').insert(0, 'first');
        source.getText('content').insert(5, ' second');
        const firstSequence = await persistence.appendUpdate(
          concurrentBoardId,
          requiredTestValue(updates[0], 'first concurrent update'),
        );
        const secondSequence = await persistence.appendUpdate(
          concurrentBoardId,
          requiredTestValue(updates[1], 'second concurrent update'),
        );
        expect(secondSequence).toBeGreaterThan(firstSequence);

        let continueLoad: (() => void) | undefined;
        let markSnapshotRead: (() => void) | undefined;
        const snapshotRead = new Promise<void>((resolve) => {
          markSnapshotRead = resolve;
        });
        const loadGate = new Promise<void>((resolve) => {
          continueLoad = resolve;
        });
        const concurrentLoader = createCollaborationPersistence(pool, {
          afterLoadSnapshotRead: async () => {
            markSnapshotRead?.();
            await loadGate;
          },
        });
        const loading = concurrentLoader.loadRoom(concurrentBoardId);
        await snapshotRead;
        await persistence.compact(
          concurrentBoardId,
          Y.encodeStateAsUpdate(source),
          secondSequence,
        );
        continueLoad?.();

        const loaded = await loading;
        expect(loaded.snapshot).toBeNull();
        expect(loaded.snapshotSequence).toBe(0);
        expect(loaded.updates.map(({ sequence }) => sequence)).toEqual([
          firstSequence,
          secondSequence,
        ]);
        const reconstructed = new Y.Doc();
        for (const entry of loaded.updates) {
          Y.applyUpdate(reconstructed, entry.update);
        }
        expect(reconstructed.getText('content').toString()).toBe(
          'first second',
        );
        reconstructed.destroy();
        source.destroy();
      } finally {
        await pool.query('DELETE FROM boards WHERE id = $1', [
          concurrentBoardId,
        ]);
      }
    });

    it('reconstructs, compacts, and resumes an append-only Yjs room', async () => {
      const source = new Y.Doc();
      const updates: Uint8Array[] = [];
      source.on('update', (update) => updates.push(update));
      source.getText('content').insert(0, 'first');
      source.getText('content').insert(5, ' second');
      expect(updates).toHaveLength(2);

      const firstSequence = await persistence.appendUpdate(
        boardId,
        requiredTestValue(updates[0], 'first room update'),
      );
      const secondSequence = await persistence.appendUpdate(
        boardId,
        requiredTestValue(updates[1], 'second room update'),
      );
      expect(secondSequence).toBeGreaterThan(firstSequence);

      const loaded = await persistence.loadRoom(boardId);
      const reconstructed = new Y.Doc();
      for (const entry of loaded.updates)
        Y.applyUpdate(reconstructed, entry.update);
      expect(reconstructed.getText('content').toString()).toBe('first second');

      await persistence.compact(
        boardId,
        Y.encodeStateAsUpdate(reconstructed),
        secondSequence,
      );
      const compacted = await persistence.loadRoom(boardId);
      expect(compacted.snapshotSequence).toBe(secondSequence);
      expect(compacted.snapshot).not.toBeNull();
      expect(compacted.updates).toHaveLength(0);

      const laterUpdates: Uint8Array[] = [];
      reconstructed.on('update', (update) => laterUpdates.push(update));
      reconstructed.getText('content').insert(12, ' third');
      await persistence.appendUpdate(
        boardId,
        requiredTestValue(laterUpdates[0], 'post-compaction update'),
      );

      const resumed = await persistence.loadRoom(boardId);
      const afterRestart = new Y.Doc();
      if (resumed.snapshot !== null)
        Y.applyUpdate(afterRestart, resumed.snapshot);
      for (const entry of resumed.updates)
        Y.applyUpdate(afterRestart, entry.update);
      expect(afterRestart.getText('content').toString()).toBe(
        'first second third',
      );
    });
  },
);
