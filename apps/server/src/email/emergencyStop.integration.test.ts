/** Executes the deployed emergency-stop shell control against PostgreSQL. */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(connectionString === undefined)(
  'email emergency-stop control',
  () => {
    const databaseUrl = new URL(connectionString ?? '');
    const pool = new Pool({ connectionString });
    const schema = `emergency_stop_${randomBytes(8).toString('hex')}`;
    const projectRoot = resolve(import.meta.dirname, '../../../..');
    const script = resolve(projectRoot, 'deploy/email-emergency-stop.sh');
    const temporaryRoot = resolve(projectRoot, 'test-results/tmp');
    let testDirectory = '';
    let composeFile = '';

    function run(scope: 'all' | 'registration', reason: string) {
      const result = spawnSync(script, [composeFile, scope, reason], {
        encoding: 'utf8',
        env: {
          ...process.env,
          EMERGENCY_TEST_DATABASE: databaseUrl.pathname.slice(1),
          EMERGENCY_TEST_HOST: databaseUrl.hostname,
          EMERGENCY_TEST_PASSWORD: decodeURIComponent(databaseUrl.password),
          EMERGENCY_TEST_PORT: databaseUrl.port || '5432',
          EMERGENCY_TEST_SCHEMA: schema,
          EMERGENCY_TEST_USER: decodeURIComponent(databaseUrl.username),
          PATH: `${resolve(testDirectory, 'bin')}:${process.env.PATH ?? ''}`,
        },
      });
      return result;
    }

    beforeAll(async () => {
      await mkdir(temporaryRoot, { recursive: true });
      testDirectory = await mkdtemp(
        resolve(temporaryRoot, 'email-emergency-stop-'),
      );
      composeFile = resolve(testDirectory, 'compose.yaml');
      const binaryDirectory = resolve(testDirectory, 'bin');
      await mkdir(binaryDirectory);
      await writeFile(composeFile, 'services: {}\n');
      const fakeDocker = resolve(binaryDirectory, 'docker');
      await writeFile(
        fakeDocker,
        `#!/bin/sh
set -eu
[ "$1" = compose ]; shift
[ "$1" = -f ]; shift 2
[ "$1" = exec ]; shift
[ "$1" = -T ]; shift
[ "$1" = postgres ]; shift
export PGHOST="$EMERGENCY_TEST_HOST"
export PGPORT="$EMERGENCY_TEST_PORT"
export PGPASSWORD="$EMERGENCY_TEST_PASSWORD"
export PGOPTIONS="-c search_path=$EMERGENCY_TEST_SCHEMA"
export POSTGRES_USER="$EMERGENCY_TEST_USER"
export POSTGRES_DB="$EMERGENCY_TEST_DATABASE"
exec "$@"
`,
      );
      await chmod(fakeDocker, 0o700);
      await pool.query(`CREATE SCHEMA ${schema}`);
      await pool.query(`
        CREATE TABLE ${schema}.email_flow_switches (
          flow TEXT PRIMARY KEY,
          enabled BOOLEAN NOT NULL,
          reason TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    });

    beforeEach(async () => {
      await pool.query(`TRUNCATE ${schema}.email_flow_switches`);
      await pool.query(
        `INSERT INTO ${schema}.email_flow_switches(flow, enabled, reason)
         VALUES ('registration', TRUE, 'before-test'),
                ('password-reset', TRUE, 'before-test'),
                ('email-change', TRUE, 'before-test')`,
      );
    });

    afterAll(async () => {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
      if (testDirectory !== '') {
        await rm(testDirectory, { force: true, recursive: true });
      }
    });

    it('disables only registration and stores the validated reason', async () => {
      const result = run('registration', 'integration-registration-stop');
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(
        'Approved email emergency stop was applied.\n',
      );

      const state = await pool.query<{
        enabled: boolean;
        flow: string;
        reason: string;
      }>(
        `SELECT flow, enabled, reason
         FROM ${schema}.email_flow_switches ORDER BY flow`,
      );
      expect(state.rows).toEqual([
        { enabled: true, flow: 'email-change', reason: 'before-test' },
        { enabled: true, flow: 'password-reset', reason: 'before-test' },
        {
          enabled: false,
          flow: 'registration',
          reason: 'integration-registration-stop',
        },
      ]);
    });

    it('disables all three fixed flows', async () => {
      const result = run('all', 'integration-all-stop');
      expect(result.status, result.stderr).toBe(0);

      const state = await pool.query<{
        enabled: boolean;
        reason: string;
      }>(
        `SELECT enabled, reason
         FROM ${schema}.email_flow_switches ORDER BY flow`,
      );
      expect(state.rows).toEqual([
        { enabled: false, reason: 'integration-all-stop' },
        { enabled: false, reason: 'integration-all-stop' },
        { enabled: false, reason: 'integration-all-stop' },
      ]);
    });

    it('rolls back every update when the fixed table shape is incomplete', async () => {
      await pool.query(
        `DELETE FROM ${schema}.email_flow_switches WHERE flow = 'email-change'`,
      );
      const result = run('all', 'integration-anomaly-stop');
      expect(result.status).not.toBe(0);

      const state = await pool.query<{
        enabled: boolean;
        reason: string;
      }>(
        `SELECT enabled, reason
         FROM ${schema}.email_flow_switches ORDER BY flow`,
      );
      expect(state.rows).toEqual([
        { enabled: true, reason: 'before-test' },
        { enabled: true, reason: 'before-test' },
      ]);
    });
  },
);
