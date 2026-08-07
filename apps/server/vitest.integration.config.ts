/** Runs serialized PostgreSQL integration suites with an explicit longer database timeout. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '../../.tmp/vite/server-integration',
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 15_000,
  },
});
