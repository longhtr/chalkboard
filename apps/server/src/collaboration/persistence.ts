/**
 * PostgreSQL authority for Yjs snapshots and ordered update tails. Appends
 * return durable sequence numbers; compaction replaces only state covered by a
 * known sequence and deletes no newer update.
 */
import type { Pool } from 'pg';

/** One snapshot plus the strictly newer durable update tail for a board. */
export interface PersistedYjsRoom {
  snapshot: Uint8Array | null;
  snapshotSequence: number;
  updates: { sequence: number; update: Uint8Array }[];
}

/** Ordered PostgreSQL operations required by an active Yjs room. */
export interface CollaborationPersistence {
  appendUpdate(boardId: string, update: Uint8Array): Promise<number>;
  compact(
    boardId: string,
    snapshot: Uint8Array,
    throughSequence: number,
  ): Promise<void>;
  loadRoom(boardId: string): Promise<PersistedYjsRoom>;
}

interface CollaborationPersistenceHooks {
  afterLoadSnapshotRead?(): Promise<void> | void;
  beforeCompactionCommit?(): Promise<void> | void;
}

/**
 * Creates append, load, and compaction operations. Compaction advances a
 * snapshot and removes only the update tail covered by that same sequence.
 */
export function createCollaborationPersistence(
  pool: Pool,
  hooks: CollaborationPersistenceHooks = {},
): CollaborationPersistence {
  return {
    async loadRoom(boardId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const documentResult = await client.query<{
          snapshot: Buffer;
          snapshot_sequence: string;
        }>(
          'SELECT snapshot, snapshot_sequence FROM yjs_documents WHERE board_id = $1',
          [boardId],
        );
        const document = documentResult.rows[0];
        const snapshotSequence = Number(document?.snapshot_sequence ?? 0);
        await hooks.afterLoadSnapshotRead?.();
        const updatesResult = await client.query<{
          sequence: string;
          update: Buffer;
        }>(
          `SELECT sequence, update
           FROM yjs_updates
           WHERE board_id = $1 AND sequence > $2
           ORDER BY sequence`,
          [boardId, snapshotSequence],
        );
        await client.query('COMMIT');
        return {
          snapshot:
            document === undefined ? null : new Uint8Array(document.snapshot),
          snapshotSequence,
          updates: updatesResult.rows.map((row) => ({
            sequence: Number(row.sequence),
            update: new Uint8Array(row.update),
          })),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async appendUpdate(boardId, update) {
      const result = await pool.query<{ sequence: string }>(
        `INSERT INTO yjs_updates (board_id, update)
         VALUES ($1, $2)
         RETURNING sequence`,
        [boardId, Buffer.from(update)],
      );
      const sequence = result.rows[0]?.sequence;
      if (sequence === undefined) throw new Error('Yjs update was not stored');
      return Number(sequence);
    },

    async compact(boardId, snapshot, throughSequence) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `chalkboard:yjs:${boardId}`,
        ]);
        await client.query(
          `INSERT INTO yjs_documents (
             board_id, snapshot, snapshot_sequence, schema_version, updated_at
           ) VALUES ($1, $2, $3, 1, NOW())
           ON CONFLICT (board_id) DO UPDATE SET
             snapshot = EXCLUDED.snapshot,
             snapshot_sequence = EXCLUDED.snapshot_sequence,
             schema_version = EXCLUDED.schema_version,
             updated_at = NOW()
           WHERE yjs_documents.snapshot_sequence <= EXCLUDED.snapshot_sequence`,
          [boardId, Buffer.from(snapshot), throughSequence],
        );
        await client.query(
          'DELETE FROM yjs_updates WHERE board_id = $1 AND sequence <= $2',
          [boardId, throughSequence],
        );
        await hooks.beforeCompactionCommit?.();
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
