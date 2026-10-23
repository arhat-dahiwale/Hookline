import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration test configuration: Testcontainers-backed tests under test/int.
 * Containers are started once per run by the global setup.
 */
export default defineConfig({
  // SWC transform: emits the decorator metadata Nest DI needs (esbuild, the
  // default Vite/Vitest transform, does not support emitDecoratorMetadata).
  plugins: [swc.vite()],
  resolve: {
    alias: {
      '@hookline/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['test/int/**/*.spec.ts'],
    environment: 'node',
    globalSetup: ['./test/int/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One file at a time: suites share the container-backed Postgres/Redis.
    fileParallelism: false,
    pool: 'forks',
  },
});
