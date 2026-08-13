/**
 * Kills a child collaboration server without graceful shutdown and proves only
 * updates acknowledged after PostgreSQL append are recovered after restart.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  COLLABORATION_MESSAGE_ACKNOWLEDGEMENT,
  COLLABORATION_MESSAGE_SYNC,
} from '@chalkboard/shared';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { runMigrations } from '../db/migrate.js';
import { requiredTestValue } from '../test/assertions.js';
import { createCollaborationPersistence } from './persistence.js';

const connectionString = process.env.TEST_DATABASE_URL;
const fixturePath = fileURLToPath(
  new URL('./crashServer.fixture.ts', import.meta.url),
);

type CrashBoundary =
  | 'after-append'
  | 'after-compaction'
  | 'before-append'
  | 'before-compaction'
  | 'before-compaction-commit'
  | 'none';

const childProcesses = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all(
    [...childProcesses].map(async (child) => {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((resolve) =>
        child.once('exit', () => resolve()),
      );
      child.kill('SIGKILL');
      await exited;
    }),
  );
});

interface RunningServer {
  boundaryReached: Promise<void>;
  child: ChildProcess;
  url: string;
}

function waitFor<T>(read: () => T | null, timeout = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      const value = read();
      if (value !== null) {
        resolve(value);
      } else if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for crash recovery state'));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

async function startServer(boundary: CrashBoundary): Promise<RunningServer> {
  const child = spawn(process.execPath, ['--import', 'tsx', fixturePath], {
    env: {
      ...process.env,
      CRASH_BOUNDARY: boundary,
      DATABASE_URL: connectionString,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  childProcesses.add(child);
  child.once('exit', () => childProcesses.delete(child));
  child.stdout?.resume();
  child.stderr?.resume();
  let port: number | null = null;
  let startupError: string | null = null;
  let markBoundaryReached: (() => void) | undefined;
  const boundaryReached = new Promise<void>((resolve) => {
    markBoundaryReached = resolve;
  });
  child.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const value = message as Record<string, unknown>;
    if (value.type === 'ready' && typeof value.port === 'number') {
      port = value.port;
    } else if (value.type === 'boundary' && value.boundary === boundary) {
      markBoundaryReached?.();
    } else if (value.type === 'error' && typeof value.message === 'string') {
      startupError = value.message;
    }
  });
  const readyPort = await waitFor(() => {
    if (startupError !== null) throw new Error(startupError);
    if (child.exitCode !== null) throw new Error('Crash fixture exited early');
    return port;
  });
  return {
    boundaryReached,
    child,
    url: `ws://127.0.0.1:${readyPort}`,
  };
}

async function killServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    server.child.once('exit', () => resolve()),
  );
  server.child.kill('SIGKILL');
  await exited;
}

class RecoveryClient {
  readonly acknowledgements: number[] = [];
  readonly socket: WebSocket;
  private readonly onDocumentUpdate: (
    update: Uint8Array,
    origin: unknown,
  ) => void;

  constructor(
    url: string,
    readonly document: Y.Doc,
  ) {
    this.socket = new WebSocket(url);
    this.onDocumentUpdate = (update, origin) => {
      if (origin === this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.socket.send(encoding.toUint8Array(encoder));
    };
    document.on('update', this.onDocumentUpdate);
    this.socket.on('open', () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.document);
      this.socket.send(encoding.toUint8Array(encoder));
    });
    this.socket.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data as Buffer));
      const type = decoding.readVarUint(decoder);
      if (type === COLLABORATION_MESSAGE_ACKNOWLEDGEMENT) {
        this.acknowledgements.push(decoding.readVarUint(decoder));
        return;
      }
      if (type !== COLLABORATION_MESSAGE_SYNC) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, COLLABORATION_MESSAGE_SYNC);
      syncProtocol.readSyncMessage(
        decoder,
        encoder,
        this.document,
        this.socket,
      );
      if (encoding.length(encoder) > 1) {
        this.socket.send(encoding.toUint8Array(encoder));
      }
    });
  }

  async opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  disconnect(): void {
    this.document.off('update', this.onDocumentUpdate);
    this.socket.terminate();
  }
}

const scenarios: {
  boundary: Exclude<CrashBoundary, 'none'>;
  durableBeforeRestart: boolean;
  snapshotBeforeRestart: boolean;
}[] = [
  {
    boundary: 'before-append',
    durableBeforeRestart: false,
    snapshotBeforeRestart: false,
  },
  {
    boundary: 'after-append',
    durableBeforeRestart: true,
    snapshotBeforeRestart: false,
  },
  {
    boundary: 'before-compaction',
    durableBeforeRestart: true,
    snapshotBeforeRestart: false,
  },
  {
    boundary: 'before-compaction-commit',
    durableBeforeRestart: true,
    snapshotBeforeRestart: false,
  },
  {
    boundary: 'after-compaction',
    durableBeforeRestart: true,
    snapshotBeforeRestart: true,
  },
];

describe.skipIf(connectionString === undefined)(
  'collaboration crash recovery',
  () => {
    const pool = new Pool({ connectionString });
    const persistence = createCollaborationPersistence(pool);
    let userId = '';
    const boardIds: string[] = [];

    beforeAll(async () => {
      await runMigrations(
        pool,
        fileURLToPath(new URL('../../migrations', import.meta.url)),
      );
      const suffix = crypto.randomUUID();
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (
           email, email_normalized, display_name, password_hash
         ) VALUES ($1, $1, 'Crash recovery', 'unused')
         RETURNING id`,
        [`crash-${suffix}@example.com`],
      );
      userId = requiredTestValue(user.rows[0], 'crash-test user row').id;
    });

    afterAll(async () => {
      for (const boardId of boardIds) {
        await pool.query('DELETE FROM boards WHERE id = $1', [boardId]);
      }
      if (userId !== '') {
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      }
      await pool.end();
    });

    it.each(scenarios)(
      'recovers after termination at $boundary',
      async ({ boundary, durableBeforeRestart, snapshotBeforeRestart }) => {
        const board = await pool.query<{ id: string }>(
          `INSERT INTO boards (title, owner_id)
           VALUES ($1, $2)
           RETURNING id`,
          [`Crash ${boundary}`, userId],
        );
        const boardId = requiredTestValue(
          board.rows[0],
          'crash-test board row',
        ).id;
        boardIds.push(boardId);
        const document = new Y.Doc();
        const crashing = await startServer(boundary);
        const first = new RecoveryClient(
          `${crashing.url}/collaboration/${boardId}`,
          document,
        );
        await first.opened();
        document.getText('value').insert(0, `survives ${boundary}`);
        await crashing.boundaryReached;
        if (boundary.includes('compaction')) {
          await waitFor(() =>
            first.acknowledgements.length > 0 ? true : null,
          );
          expect(first.acknowledgements).toHaveLength(1);
        } else {
          expect(first.acknowledgements).toEqual([]);
        }
        await killServer(crashing);
        first.disconnect();

        const stored = await persistence.loadRoom(boardId);
        expect(stored.snapshot !== null).toBe(snapshotBeforeRestart);
        expect(stored.snapshot !== null || stored.updates.length > 0).toBe(
          durableBeforeRestart,
        );
        expect(stored.updates).toHaveLength(
          snapshotBeforeRestart ? 0 : durableBeforeRestart ? 1 : 0,
        );

        const restarted = await startServer('none');
        const replaying = new RecoveryClient(
          `${restarted.url}/collaboration/${boardId}`,
          document,
        );
        await replaying.opened();
        await waitFor(() =>
          document.getText('value').toString() === `survives ${boundary}`
            ? true
            : null,
        );
        const observerDocument = new Y.Doc();
        const observer = new RecoveryClient(
          `${restarted.url}/collaboration/${boardId}`,
          observerDocument,
        );
        await observer.opened();
        await waitFor(() =>
          observerDocument.getText('value').toString() ===
          `survives ${boundary}`
            ? true
            : null,
        );

        observer.disconnect();
        observerDocument.destroy();
        replaying.disconnect();
        document.destroy();
        await killServer(restarted);
      },
      20_000,
    );
  },
);
