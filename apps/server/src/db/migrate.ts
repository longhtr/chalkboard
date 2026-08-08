/**
 * Applies forward-only SQL migrations under one PostgreSQL advisory lock.
 * Stored checksums make edited historical migrations fail explicitly instead
 * of silently changing the meaning of an already-applied schema version.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { loadDatabaseUrl } from '../config.js';
import { MIGRATION_LOCK_NAME, RUNTIME_LOCK_NAME } from './locks.js';

interface AppliedMigration {
  checksum: string;
  name: string;
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** Applies pending migrations in filename order and returns the names newly applied. */
export async function runMigrations(
  pool: Pool,
  migrationsDirectory = resolve(process.cwd(), 'migrations'),
): Promise<string[]> {
  const client = await pool.connect();
  let migrationLocked = false;
  let runtimeLocked = false;
  try {
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
        'Database migrations require the production collaboration server to be stopped',
      );
    }
    runtimeLocked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const appliedResult = await client.query<AppliedMigration>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    );
    const applied = new Map(
      appliedResult.rows.map((migration) => [
        migration.name,
        migration.checksum,
      ]),
    );
    const completed: string[] = [];

    for (const name of migrationNames) {
      const sql = await readFile(resolve(migrationsDirectory, name), 'utf8');
      const migrationChecksum = checksum(sql);
      const previousChecksum = applied.get(name);

      if (previousChecksum !== undefined) {
        if (previousChecksum !== migrationChecksum) {
          throw new Error(`Applied migration has changed: ${name}`);
        }
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, migrationChecksum],
        );
        await client.query('COMMIT');
        completed.push(name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return completed;
  } finally {
    try {
      if (runtimeLocked) {
        await client.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [RUNTIME_LOCK_NAME],
        );
      }
    } finally {
      try {
        if (migrationLocked) {
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [MIGRATION_LOCK_NAME],
          );
        }
      } finally {
        client.release();
      }
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadDatabaseUrl() });

  try {
    const completed = await runMigrations(pool);
    if (completed.length === 0) {
      console.log('Database schema is up to date.');
    } else {
      console.log(`Applied migrations: ${completed.join(', ')}`);
    }
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
