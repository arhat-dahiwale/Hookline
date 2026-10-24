import { defineConfig } from '@playwright/test';

const API_PORT = 4000;
const WEB_PORT = 3100;

/**
 * E2E suite: boots the real API (built dist, ROLE=all) and the Next.js dev
 * server, against the dev compose Postgres/Redis. Tests use unique emails so
 * runs don't collide; everything is org-scoped.
 *
 * The webhook target for deliveries is the in-app mock receiver route
 * (/api/mock-receiver) — no external network access.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @hookline/server db:migrate && node apps/server/dist/main.js',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ALLOW_INSECURE_ENDPOINTS: 'true',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm --filter @hookline/web dev`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
