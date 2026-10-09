/**
 * Cross-checks application diagnostics against package metadata, shared schema
 * versions, and the actual ordered migration files on disk.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CHALKBOARD_SCHEMA_VERSIONS } from '@chalkboard/shared';
import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('application diagnostics source contracts', () => {
  it('tracks the terminal PostgreSQL migration', async () => {
    const migrations = (await readdir(resolve('migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    expect(migrations.at(-1)).toBe(
      CHALKBOARD_SCHEMA_VERSIONS.postgresMigration,
    );
  });

  it('keeps the development diagnostic version aligned with the package', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve('package.json'), 'utf8'),
    ) as { version?: unknown };

    expect(loadConfig({}).applicationVersion).toBe(packageJson.version);
  });
});
