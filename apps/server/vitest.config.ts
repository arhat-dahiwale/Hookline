import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC transform: emits the decorator metadata Nest DI needs (esbuild, the
  // default Vite/Vitest transform, does not support emitDecoratorMetadata).
  // Explicit jsc options because tsconfig `extends` resolution is unreliable
  // in the plugin.
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
      // Lint against the shared package source so unit tests do not require a
      // fresh build of @hookline/shared.
      '@hookline/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Bind thresholds to exactly the files unit tests own end to end;
      // service-module coverage is enforced by the integration config.
      include: ['src/modules/delivery-engine/signing.ts', 'src/modules/delivery-queue/backoff.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        // Core modules with unit-pure logic (AGENTS.md section 6).
        lines: 90,
        'src/modules/delivery-engine/signing.ts': { lines: 100 },
        'src/modules/delivery-queue/backoff.ts': { lines: 100 },
      },
    },
  },
});
