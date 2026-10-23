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
  },
});
