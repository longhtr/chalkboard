/** Proves demo identities are repeatable, credential-restoring, and runtime-safe. */
import { DEMO_ACCOUNTS } from '@chalkboard/shared';
import { verify } from '@node-rs/argon2';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { MAX_DEMO_API_MUTATIONS_PER_MINUTE } from '../api/routes.js';
import { loadConfig } from '../config.js';
import {
  requiredTestObject,
  requiredTestValue,
  responseCookie,
} from '../test/assertions.js';
import { RUNTIME_LOCK_NAME } from './locks.js';
import { runMigrations } from './migrate.js';
import { seedDemoAccounts } from './seedDemoAccounts.js';

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(connectionString === undefined)('demo account seeding', () => {
  const adminPool = new Pool({ connectionString });
  const schema = `demo_accounts_${crypto.randomUUID().replaceAll('-', '_')}`;
  const appDatabaseUrl = new URL(
    connectionString ?? 'postgresql://unused:unused@127.0.0.1/unused',
  );
  appDatabaseUrl.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });

  beforeAll(async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    await runMigrations(pool, resolve(process.cwd(), 'migrations'));
  });

  afterAll(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await adminPool.end();
  });

  it('creates all identities with usable public credentials', async () => {
    expect(await seedDemoAccounts(pool)).toBe(5);
    const result = await pool.query<{
      display_name: string;
      email: string;
      is_demo: boolean;
      password_hash: string;
    }>(
      `SELECT display_name, email, is_demo, password_hash
       FROM users
       WHERE email_normalized = ANY($1::text[])
       ORDER BY email_normalized`,
      [DEMO_ACCOUNTS.map(({ email }) => email)],
    );

    expect(result.rows).toHaveLength(5);
    for (const [index, row] of result.rows.entries()) {
      const account = requiredTestValue(
        DEMO_ACCOUNTS[index],
        `demo account ${index}`,
      );
      expect(row).toMatchObject({
        display_name: account.displayName,
        email: account.email,
        is_demo: true,
      });
      await expect(verify(row.password_hash, account.password)).resolves.toBe(
        true,
      );
    }
  });

  it('restores credentials and revokes sessions without deleting boards', async () => {
    const account = requiredTestValue(DEMO_ACCOUNTS[0], 'first demo account');
    const user = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE email_normalized = $1',
      [account.email],
    );
    const userId = requiredTestValue(user.rows[0], 'seeded demo user').id;
    await pool.query(
      `UPDATE users SET display_name = 'Changed', password_hash = 'invalid'
       WHERE id = $1`,
      [userId],
    );
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [userId, Buffer.from(crypto.randomUUID())],
    );
    await pool.query('INSERT INTO boards (title, owner_id) VALUES ($1, $2)', [
      'Persistent demo board',
      userId,
    ]);

    expect(await seedDemoAccounts(pool)).toBe(5);

    const restored = await pool.query<{
      display_name: string;
      password_hash: string;
    }>('SELECT display_name, password_hash FROM users WHERE id = $1', [userId]);
    const row = requiredTestValue(restored.rows[0], 'restored demo user');
    expect(row.display_name).toBe(account.displayName);
    await expect(verify(row.password_hash, account.password)).resolves.toBe(
      true,
    );
    const session = await pool.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE user_id = $1',
      [userId],
    );
    expect(requiredTestValue(session.rows[0], 'demo session').revoked).toBe(
      true,
    );
    const board = await pool.query<{ title: string }>(
      'SELECT title FROM boards WHERE owner_id = $1',
      [userId],
    );
    expect(board.rows).toEqual([{ title: 'Persistent demo board' }]);
  });

  it('locks identity mutations while leaving cloud-board routes available', async () => {
    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: appDatabaseUrl.toString(),
        NODE_ENV: 'test',
      }),
    });
    await app.ready();
    try {
      const account = requiredTestValue(DEMO_ACCOUNTS[0], 'first demo account');
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: account.email, password: account.password },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toMatchObject({ user: { isDemo: true } });
      const cookie = responseCookie(login.headers['set-cookie']);

      for (const mutation of [
        {
          method: 'PATCH' as const,
          url: '/api/account/display-name',
          payload: { displayName: 'Hijacked demo' },
        },
        {
          method: 'PATCH' as const,
          url: '/api/account/email',
          payload: {
            currentPassword: account.password,
            email: 'hijacked@example.com',
          },
        },
        {
          method: 'PATCH' as const,
          url: '/api/account/password',
          payload: {
            currentPassword: account.password,
            newPassword: 'hijacked password',
          },
        },
      ]) {
        const response = await app.inject({
          ...mutation,
          headers: { cookie },
        });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({
          error: 'Demo account details cannot be changed',
        });
      }

      const cloudBoard = await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: { cookie },
        payload: { title: 'Demo cloud board' },
      });
      expect(cloudBoard.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('bounds retained sessions and shared demo API mutations', async () => {
    const account = requiredTestValue(DEMO_ACCOUNTS[0], 'first demo account');
    const user = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE email_normalized = $1',
      [account.email],
    );
    const userId = requiredTestValue(user.rows[0], 'seeded demo user').id;
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       SELECT $1::uuid, decode(md5($1::text || value::text), 'hex'),
         NOW() + INTERVAL '1 day'
       FROM generate_series(1, 100) AS value`,
      [userId],
    );

    const app = buildApp({
      config: loadConfig({
        DATABASE_URL: appDatabaseUrl.toString(),
        NODE_ENV: 'test',
      }),
    });
    await app.ready();
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: account.email, password: account.password },
      });
      const cookie = responseCookie(login.headers['set-cookie']);
      const sessions = await pool.query<{ count: string }>(
        'SELECT count(*) FROM sessions WHERE user_id = $1',
        [userId],
      );
      expect(requiredTestValue(sessions.rows[0], 'session count').count).toBe(
        '100',
      );

      const created = await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: { cookie },
        payload: { title: 'Mutation-limited board' },
      });
      expect(created.statusCode).toBe(201);
      const boardId = requiredTestObject(
        created.json().board,
        'created demo board',
      ).id;
      expect(typeof boardId).toBe('string');
      for (
        let index = 1;
        index < MAX_DEMO_API_MUTATIONS_PER_MINUTE;
        index += 1
      ) {
        const renamed = await app.inject({
          method: 'PATCH',
          url: `/api/boards/${String(boardId)}`,
          headers: { cookie },
          payload: { title: `Rename ${index}` },
        });
        expect(renamed.statusCode).toBe(200);
      }
      const limited = await app.inject({
        method: 'PATCH',
        url: `/api/boards/${String(boardId)}`,
        headers: { cookie },
        payload: { title: 'Over limit' },
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({
        error: 'Demo activity limit reached. Try again shortly.',
      });

      // Requests rejected by one identity's independent ceiling must not spend
      // the aggregate allowance and starve the other public demo identities.
      for (
        let index = 0;
        index < MAX_DEMO_API_MUTATIONS_PER_MINUTE * 2;
        index += 1
      ) {
        const stillLimited = await app.inject({
          method: 'PATCH',
          url: `/api/boards/${String(boardId)}`,
          headers: { cookie },
          payload: { title: `Rejected rename ${index}` },
          remoteAddress: `2001:db8::${index + 1}`,
        });
        expect(stillLimited.statusCode).toBe(429);
      }

      const secondAccount = requiredTestValue(
        DEMO_ACCOUNTS[1],
        'second demo account',
      );
      const secondLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: secondAccount.email,
          password: secondAccount.password,
        },
        remoteAddress: '198.51.100.1',
      });
      const secondCookie = responseCookie(secondLogin.headers['set-cookie']);
      const secondBoard = await app.inject({
        method: 'POST',
        url: '/api/boards',
        headers: { cookie: secondCookie },
        payload: { title: 'Fair aggregate admission' },
        remoteAddress: '198.51.100.2',
      });
      expect(secondBoard.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it('refuses to reseed while the collaboration runtime lock is held', async () => {
    const blocker = await adminPool.connect();
    try {
      await blocker.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        RUNTIME_LOCK_NAME,
      ]);
      await expect(seedDemoAccounts(pool)).rejects.toThrow(
        'requires the production collaboration server to be stopped',
      );
    } finally {
      await blocker.query(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
        [RUNTIME_LOCK_NAME],
      );
      blocker.release();
    }
  });
});
