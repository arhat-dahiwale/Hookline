import { fileURLToPath } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC transform: emits the decorator metadata Nest DI needs (esbuild, the
  // default Vite/Vitest transform, does not support emitDecoratorMetadata).
  plugins: [swc.vite()],
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
