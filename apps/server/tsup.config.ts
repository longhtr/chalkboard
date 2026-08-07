/** Builds the server and migration runner as Node 24 ESM while bundling the shared workspace. */
import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: false,
  entry: {
    index: './src/index.ts',
    migrate: './src/db/migrate.ts',
  },
  format: ['esm'],
  noExternal: ['@chalkboard/shared'],
  platform: 'node',
  sourcemap: true,
  splitting: false,
  target: 'node24',
});
