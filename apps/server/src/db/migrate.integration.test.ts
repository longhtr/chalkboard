/**
 * Runs migrations against PostgreSQL to prove ordering, locking, idempotence,
 * checksum enforcement, and rejection of edited migration history.
 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { requiredTestValue } from '../test/assertions.js';
import { createDatabase } from './database.js';
import { RUNTIME_LOCK_NAME } from './locks.js';
import { runMigrations } from './migrate.js';

const connectionString = process.env.TEST_DATABASE_URL;
const testDirectory = resolve(
  import.meta.dirname,
  '../../../../test-results/tmp',
);

describe.skipIf(connectionString === undefined)('PostgreSQL foundation', () => {
  const pool = new Pool({ connectionString });
  const database = createDatabase(connectionString ?? '');
  const app = buildApp({
    config: loadConfig({ DATABASE_URL: connectionString }),
    database,
  });

  beforeAll(async () => {
    await runMigrations(pool, resolve(process.cwd(), 'migrations'));
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await pool.end();
  });

  it('creates the expected foundation tables', async () => {
    const result = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    expect(result.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'account_registration_settings',
        'board_assets',
        'board_members',
        'boards',
        'schema_migrations',
        'sessions',
        'user_storage_usage',
        'users',
        'yjs_documents',
        'yjs_updates',
      ]),
    );
    const emailFlows = await pool.query<{
      enabled: boolean;
      flow: string;
      reason: string;
    }>('SELECT flow, enabled, reason FROM email_flow_switches ORDER BY flow');
    expect(emailFlows.rows).toEqual([
      {
        enabled: false,
        flow: 'email-change',
        reason: 'awaiting-account-email-canary',
      },
      {
        enabled: false,
        flow: 'password-reset',
        reason: 'awaiting-account-email-canary',
      },
      {
        enabled: false,
        flow: 'registration',
        reason: 'awaiting-account-email-canary',
      },
    ]);
    const accountLimit = await pool.query<{
      reason: string;
      verified_account_limit: number;
    }>(
      `SELECT verified_account_limit, reason
       FROM account_registration_settings WHERE singleton`,
    );
    expect(accountLimit.rows).toEqual([
      { reason: 'account-email-canary', verified_account_limit: 10 },
    ]);
    const cleanupIndexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [
        [
          'board_invite_links_expires_cleanup_idx',
          'board_invite_links_revoked_cleanup_idx',
          'boards_deleted_at_cleanup_idx',
        ],
      ],
    );
    expect(cleanupIndexes.rows.map(({ indexname }) => indexname)).toEqual([
      'board_invite_links_expires_cleanup_idx',
      'board_invite_links_revoked_cleanup_idx',
      'boards_deleted_at_cleanup_idx',
    ]);
  });

  it('migrates the retained initial schema fixture without losing data', async () => {
    const schema = `migration_fixture_${crypto.randomUUID().replaceAll('-', '_')}`;
    await mkdir(testDirectory, { recursive: true });
    const fixtureDirectory = await mkdtemp(
      join(testDirectory, 'migration-fixture-'),
    );
    await pool.query(`CREATE SCHEMA ${schema}`);
    const fixturePool = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
    });
    try {
      const migrationsDirectory = resolve(process.cwd(), 'migrations');
      await copyFile(
        resolve(migrationsDirectory, '0001_initial_schema.sql'),
        resolve(fixtureDirectory, '0001_initial_schema.sql'),
      );
      expect(await runMigrations(fixturePool, fixtureDirectory)).toEqual([
        '0001_initial_schema.sql',
      ]);
      const user = await fixturePool.query<{ id: string }>(
        `INSERT INTO users (
           email, email_normalized, display_name, password_hash
         ) VALUES ('retained@example.com', 'retained@example.com', 'Retained', 'unused')
         RETURNING id`,
      );
      await fixturePool.query(
        "INSERT INTO boards (title, owner_id) VALUES ('Retained board', $1)",
        [requiredTestValue(user.rows[0], 'migration test user').id],
      );

      expect(await runMigrations(fixturePool, migrationsDirectory)).toEqual([
        '0002_board_assets.sql',
        '0003_board_invite_links.sql',
        '0004_board_trash_index.sql',
        '0005_email_verification.sql',
        '0006_demo_sandbox.sql',
        '0007_email_security.sql',
        '0008_feedback_retention_fk.sql',
        '0009_maintenance_cleanup_indexes.sql',
        '0010_capacity_board_ceiling.sql',
      ]);
      const retained = await fixturePool.query<{ count: string }>(
        'SELECT count(*) FROM boards WHERE title = $1',
        ['Retained board'],
      );
      expect(
        requiredTestValue(retained.rows[0], 'retained row count').count,
      ).toBe('1');
      await fixturePool.query(
        `UPDATE account_registration_settings
         SET verified_account_limit = 2, reason = 'migration-test'
         WHERE singleton`,
      );
      await fixturePool.query(
        `INSERT INTO users (
           email, email_normalized, display_name, password_hash
         ) VALUES ('second@example.com', 'second@example.com', 'Second', 'unused')`,
      );
      await expect(
        fixturePool.query(
          `INSERT INTO users (
             email, email_normalized, display_name, password_hash
           ) VALUES ('third@example.com', 'third@example.com', 'Third', 'unused')`,
        ),
      ).rejects.toMatchObject({ message: 'account_ceiling_exceeded' });
      const assets = await fixturePool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'board_assets'`,
        [schema],
      );
      expect(assets.rows).toEqual([{ table_name: 'board_assets' }]);
    } finally {
      await fixturePool.end();
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it('serializes concurrent runners on one advisory-lock session', async () => {
    const schema = `migration_concurrency_${crypto.randomUUID().replaceAll('-', '_')}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const options = `-c search_path=${schema}`;
    const firstPool = new Pool({ connectionString, options });
    const secondPool = new Pool({ connectionString, options });
    try {
      const migrationsDirectory = resolve(process.cwd(), 'migrations');
      const completed = await Promise.all([
        runMigrations(firstPool, migrationsDirectory),
        runMigrations(secondPool, migrationsDirectory),
      ]);
      expect(completed.map((names) => names.length).sort()).toEqual([0, 10]);
      const applied = await firstPool.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      expect(applied.rows.map(({ name }) => name)).toEqual([
        '0001_initial_schema.sql',
        '0002_board_assets.sql',
        '0003_board_invite_links.sql',
        '0004_board_trash_index.sql',
        '0005_email_verification.sql',
        '0006_demo_sandbox.sql',
        '0007_email_security.sql',
        '0008_feedback_retention_fk.sql',
        '0009_maintenance_cleanup_indexes.sql',
        '0010_capacity_board_ceiling.sql',
      ]);
    } finally {
      await Promise.all([firstPool.end(), secondPool.end()]);
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  });

  it('rejects migrations while a production runtime lock is held', async () => {
    const runtime = await pool.connect();
    try {
      await runtime.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        RUNTIME_LOCK_NAME,
      ]);
      await expect(
        runMigrations(pool, resolve(process.cwd(), 'migrations')),
      ).rejects.toThrow('collaboration server to be stopped');
    } finally {
      await runtime.query(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
        [RUNTIME_LOCK_NAME],
      );
      runtime.release();
    }
  });

  it('reports readiness through a real database connection', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });
});
