import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
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
