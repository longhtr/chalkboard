/** PostgreSQL-backed Playwright configuration for cloud, account, recovery, and asset stories. */
import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://chalkboard:chalkboard@127.0.0.1:5433/chalkboard';

export default defineConfig({
  // Account flows wait on argon2, which is deliberately expensive: registration
  // hashes both a password and a verification code before it answers. A shared
  // CI runner takes several times longer than a development machine, so these
  // budgets describe the slow case rather than the fast one. A genuine hang
  // still fails, just later.
  expect: { timeout: 20_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: 'test-results/playwright/cloud',
  projects: [
    {
      name: 'cloud-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: process.env.CI ? 'github' : 'list',
  retries: 0,
  testDir: './tests',
  testMatch: '**/*.cloud.spec.ts',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm db:migrate && pnpm --filter @chalkboard/server dev',
      env: {
        DATABASE_URL: databaseUrl,
        HOST: '127.0.0.1',
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
        PORT: '3001',
        YJS_COMPACTION_UPDATE_THRESHOLD: '3',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      url: 'http://127.0.0.1:3001/health/ready',
    },
    {
      command: 'pnpm --filter @chalkboard/web dev --port 4174',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3001' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      url: 'http://127.0.0.1:4174',
    },
  ],
  workers: 1,
});
