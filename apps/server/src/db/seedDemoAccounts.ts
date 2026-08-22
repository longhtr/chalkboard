/**
 * Creates the public demo identities after migrations and before the production
 * server starts. Reseeding restores known credentials and revokes old sessions
 * while preserving cloud boards created by visitors.
 */
import { DEMO_ACCOUNTS } from '@chalkboard/shared';
import { hash } from '@node-rs/argon2';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { loadDatabaseUrl } from '../config.js';
import { writeOperationalError } from '../operations/errorDiagnostics.js';
import { runWithFailurePreservingCleanup } from '../operations/failurePreservation.js';
import { MIGRATION_LOCK_NAME, RUNTIME_LOCK_NAME } from './locks.js';
import { rollbackPreservingFailure } from './transactionFailure.js';

const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  outputLen: 32,
  parallelism: 1,
  timeCost: 2,
} as const;

/** Idempotently restores all public demo identities and returns their count. */
export async function seedDemoAccounts(pool: Pool): Promise<number> {
  const client = await pool.connect();
  let migrationLocked = false;
  let runtimeLocked = false;
  return runWithFailurePreservingCleanup(
    async () => {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        MIGRATION_LOCK_NAME,
      ]);
      migrationLocked = true;
      const runtimeLock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        [RUNTIME_LOCK_NAME],
      );
      if (runtimeLock.rows[0]?.acquired !== true) {
        throw new Error(
          'Demo account seeding requires the production collaboration server to be stopped',
        );
      }
      runtimeLocked = true;

      const passwordHashes: string[] = [];
      for (const account of DEMO_ACCOUNTS) {
        passwordHashes.push(await hash(account.password, ARGON2_OPTIONS));
      }

      await client.query('BEGIN');
      try {
        const userIds: string[] = [];
        for (const [index, account] of DEMO_ACCOUNTS.entries()) {
          const result = await client.query<{ id: string }>(
            `INSERT INTO users (
             email, email_normalized, display_name, password_hash, is_demo
           ) VALUES ($1, $2, $3, $4, TRUE)
           ON CONFLICT (email_normalized) DO UPDATE SET
             email = EXCLUDED.email,
             display_name = EXCLUDED.display_name,
             password_hash = EXCLUDED.password_hash,
             is_demo = TRUE,
             updated_at = NOW()
           RETURNING id`,
            [
              account.email,
              account.email,
              account.displayName,
              passwordHashes[index],
            ],
          );
          const userId = result.rows[0]?.id;
          if (userId === undefined) {
            throw new Error(
              `Demo account upsert returned no user at index ${index}`,
            );
          }
          userIds.push(userId);
        }
        await client.query(
          `UPDATE sessions
         SET revoked_at = NOW()
         WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
          [userIds],
        );
        await client.query(
          'DELETE FROM pending_registrations WHERE email_normalized = ANY($1::text[])',
          [DEMO_ACCOUNTS.map(({ email }) => email)],
        );
        await client.query('COMMIT');
      } catch (error) {
        throw await rollbackPreservingFailure(client, error);
      }
      return DEMO_ACCOUNTS.length;
    },
    [
      async () => {
        if (!runtimeLocked) return;
        await client.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [RUNTIME_LOCK_NAME],
        );
      },
      async () => {
        if (!migrationLocked) return;
        await client.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [MIGRATION_LOCK_NAME],
        );
      },
      () => client.release(),
    ],
    'Demo seeding operation or advisory-lock cleanup failed',
  );
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadDatabaseUrl() });
  await runWithFailurePreservingCleanup(
    async () => {
      const count = await seedDemoAccounts(pool);
      console.log(`Seeded ${count} public demo accounts.`);
    },
    [() => pool.end()],
    'Demo seed command or pool cleanup failed',
  );
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  main().catch((error: unknown) => {
    writeOperationalError('database.demo-seed', error);
    process.exitCode = 1;
  });
}
