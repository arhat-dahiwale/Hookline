import 'reflect-metadata';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { loadAppConfig } from './modules/platform/index.js';

/**
 * Production migration runner for the one-shot `migrate` service: applies
 * ./drizzle with drizzle-orm's runtime migrator (a PROD dependency), so the
 * container needs no devDependencies (no drizzle-kit). Exits 0 on success.
 */
async function main(): Promise<void> {
  const config = loadAppConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool);
    // Relative to cwd: apps/server on the host, /app in the container (the
    // Dockerfile ships ./drizzle next to dist).
    await migrate(db, { migrationsFolder: 'drizzle' });
    process.stdout.write('migrate: applied\n');
    await pool.end();
  } catch (error) {
    process.stderr.write(`migrate failed: ${error instanceof Error ? error.message : error}\n`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
}

void main();
