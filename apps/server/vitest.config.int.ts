import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Integration test configuration: Testcontainers-backed tests under test/int.
 * Containers are started once per run by the global setup.
 */
export default defineConfig({
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
