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
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/modules/delivery-engine/**',
        'src/modules/auth/**',
        'src/modules/events/**',
        'src/modules/api-keys/**',
      ],
      // Spec files, barrel re-exports, and the Better Auth GENERATED schema
      // (AGENTS.md: never hand-edited) carry no hand-written logic to measure.
      exclude: ['**/*.spec.ts', '**/index.ts', 'src/modules/auth/auth-schema.ts'],
      thresholds: {
        lines: 90,
        // Named core modules (AGENTS.md section 6): delivery engine (incl.
        // breaker, processor, signing), auth guards, idempotency (events).
        'src/modules/delivery-engine/breaker.ts': { lines: 90 },
        'src/modules/delivery-engine/delivery-processor.ts': { lines: 90 },
        'src/modules/delivery-engine/signing.ts': { lines: 100 },
        'src/modules/auth/session.guard.ts': { lines: 100 },
        'src/modules/auth/roles.guard.ts': { lines: 95 },
        'src/modules/api-keys/api-key.guard.ts': { lines: 100 },
        'src/modules/events/events.service.ts': { lines: 90 },
      },
    },
  },
});
