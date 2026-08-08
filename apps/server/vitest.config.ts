/** Runs server unit tests in Node and excludes every PostgreSQL-dependent integration suite. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '../../.tmp/vite/server-unit',
  test: {
    environment: 'node',
    exclude: ['**/*.integration.test.ts', '**/dist/**', '**/node_modules/**'],
  },
});
