/**
 * Uses PostgreSQL to prove runtime ownership is exclusive and released when
 * the owning database lifetime closes.
 */
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from './database.js';
import { runMigrations } from './migrate.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error(
    'TEST_DATABASE_URL is required for database integration tests',
  );
}

const databases: Database[] = [];
const migrationPool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await runMigrations(migrationPool);
});

afterAll(async () => {
  await migrationPool.end();
});

afterEach(async () => {
  await Promise.all(
    databases
      .splice(0)
      .map((database) => database.close().catch(() => undefined)),
  );
});

describe('production runtime lock', () => {
  it('reports only aggregate account capacity and effective email-flow switches', async () => {
    const database = createDatabase(databaseUrl, undefined, null, {
      'email-change': true,
      'password-reset': true,
      registration: true,
    });
    databases.push(database);
    await expect(database.emailOperationalStatus()).resolves.toMatchObject({
      flows: {
        'email-change': true,
        'password-reset': true,
        registration: true,
      },
      verifiedAccountCount: expect.any(Number),
      verifiedAccountLimit: 250,
    });
  });

  it('allows exactly one collaboration server and releases on close', async () => {
    const first = createDatabase(databaseUrl);
    const second = createDatabase(databaseUrl);
    databases.push(first, second);
    expect(first.metricsSnapshot()).toMatchObject({
      passwordWorkActive: 0,
      passwordWorkConcurrent: 4,
      passwordWorkPending: 16,
      passwordWorkQueued: 0,
    });

    await expect(first.acquireRuntimeLock()).resolves.toBeUndefined();
    await expect(first.acquireRuntimeLock()).resolves.toBeUndefined();
    await expect(second.acquireRuntimeLock()).rejects.toThrow(
      'Another Chalkboard collaboration server',
    );

    await first.close();
    databases.splice(databases.indexOf(first), 1);
    await expect(second.acquireRuntimeLock()).resolves.toBeUndefined();
  });
});
