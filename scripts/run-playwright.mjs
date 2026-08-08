#!/usr/bin/env node

/** Runs Playwright with browser, result, and temporary files confined to ignored repository directories. */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Each run owns a subdirectory and removes only that. Deleting `.tmp` wholesale
// would pull the browser profiles out from under a concurrent run — including a
// bare `--list` — and discard the Vite caches that other suites keep there.
const temporaryDirectory = resolve('.tmp', `playwright-${process.pid}`);
const browserDirectory = resolve('node_modules/.cache/playwright');
mkdirSync(temporaryDirectory, { recursive: true });
mkdirSync(browserDirectory, { recursive: true });

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'playwright', ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browserDirectory,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      TMPDIR: temporaryDirectory,
    },
    stdio: 'inherit',
  },
);
rmSync(temporaryDirectory, { force: true, recursive: true });
if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
