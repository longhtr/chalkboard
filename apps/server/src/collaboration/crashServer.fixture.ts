/**
 * Child-process server used only by crash-recovery tests. It exposes a ready
 * signal but deliberately adds no graceful-shutdown behavior beyond production
 * composition, allowing the parent test to kill it abruptly.
 */
import { Pool } from 'pg';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import {
  createCollaborationPersistence,
  type CollaborationPersistence,
} from './persistence.js';

const CRASH_BOUNDARIES = [
  'after-append',
  'after-compaction',
  'before-append',
  'before-compaction',
  'before-compaction-commit',
  'none',
] as const;

type CrashBoundary = (typeof CRASH_BOUNDARIES)[number];

function crashBoundary(value: string | undefined): CrashBoundary {
  const candidate = value ?? 'none';
  const boundary = CRASH_BOUNDARIES.find((entry) => entry === candidate);
  if (boundary === undefined) {
    throw new Error(`Unsupported CRASH_BOUNDARY: ${candidate}`);
  }
  return boundary;
}

const boundary = crashBoundary(process.env.CRASH_BOUNDARY);
let boundaryReached = false;

async function pauseAt(candidate: CrashBoundary): Promise<void> {
  if (boundary !== candidate || boundaryReached) return;
  boundaryReached = true;
  process.send?.({ boundary: candidate, type: 'boundary' });
  await new Promise<never>(() => undefined);
}

async function startFixtureServer(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const stored = createCollaborationPersistence(pool, {
    beforeCompactionCommit: () => pauseAt('before-compaction-commit'),
  });
  const persistence: CollaborationPersistence = {
    async appendUpdate(boardId, update) {
      await pauseAt('before-append');
      const sequence = await stored.appendUpdate(boardId, update);
      await pauseAt('after-append');
      return sequence;
    },
    async compact(boardId, snapshot, throughSequence) {
      await pauseAt('before-compaction');
      await stored.compact(boardId, snapshot, throughSequence);
      await pauseAt('after-compaction');
    },
    loadRoom: (boardId) => stored.loadRoom(boardId),
  };
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    PORT: '3000',
    YJS_COMPACTION_UPDATE_THRESHOLD: '1',
  });
  const app = buildApp({
    config,
    database: {
      close: async () => pool.end(),
      collaboration: persistence,
      ping: async () => pool.query('SELECT 1').then(() => undefined),
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Missing server address');
  }
  process.send?.({ port: address.port, type: 'ready' });
}

void startFixtureServer().catch((error: unknown) => {
  process.send?.({ message: String(error), type: 'error' });
  process.exitCode = 1;
});
