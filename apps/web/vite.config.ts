/** Web build/test configuration plus development API, health, and WebSocket proxy boundaries. */
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const VENDOR_NOTICES = [
  'ATTRIBUTION.txt',
  'KATEX_FONT_NOTICE.txt',
  'MATHLIVE_LICENSE.txt',
  'OFL.txt',
];

/**
 * The build emits the vendored Excalifont outlines, and the SIL Open Font
 * License requires its notice to accompany every copy of them. Copying from the
 * sealed vendor directory keeps one source of truth instead of a duplicate that
 * could drift, and a missing notice fails the build rather than shipping.
 */
function vendorNotices(): Plugin {
  return {
    apply: 'build',
    name: 'chalkboard-vendor-notices',
    async closeBundle() {
      const source = resolve(import.meta.dirname, 'src/vendor/excalifont');
      const target = resolve(import.meta.dirname, 'dist/licenses');
      await mkdir(target, { recursive: true });
      await Promise.all(
        VENDOR_NOTICES.map((name) =>
          copyFile(resolve(source, name), resolve(target, name)),
        ),
      );
    },
  };
}

export default defineConfig({
  cacheDir: '../../tmp/vite/web',
  build: {
    // MathJax and its complete TeX SVG font are intentionally isolated and
    // loaded behind the immediate MathLive fallback.
    chunkSizeWarningLimit: 3_000,
  },
  plugins: [react(), vendorNotices()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        changeOrigin: false,
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
      },
      '/collaboration': {
        target: process.env.API_PROXY_TARGET ?? 'ws://127.0.0.1:3000',
        ws: true,
      },
      '/health': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
