/** Runs shared tests in Node because this workspace cannot depend on browser APIs. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '../../tmp/vite/shared',
});
