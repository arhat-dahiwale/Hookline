/**
 * Standalone Better Auth config.
 *
 * Loaded by the Better Auth CLI to generate the Drizzle schema:
 *   pnpm dlx @better-auth/cli@1.4.21 generate --config ./auth.config.ts \
 *     --output ./src/modules/auth/auth-schema.ts --yes
 *
 * Kept free of Nest imports so the CLI can execute it directly.
 */
import { config as loadDotenvFile } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { createAuth } from './src/modules/auth/auth-options.js';

for (const path of ['.env', '../../.env']) {
  loadDotenvFile({ path, quiet: true });
}
const env = process.env as Record<string, string | undefined>;

// Lazy pool: never connects until a query runs, so the CLI can import this
// file without a database.
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });

export const auth = createAuth(drizzle(pool), {
  secret: env.BETTER_AUTH_SECRET ?? '',
  baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:4000',
  useSecureCookies: env.NODE_ENV === 'production',
});
