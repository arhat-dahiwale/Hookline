import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const ENV_FILE = resolve(process.cwd(), 'test/int/.testenv.json');
const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

/**
 * Starts one Postgres and one Redis container per test run, applies all
 * migrations, and writes connection details to test/int/.testenv.json for
 * the worker processes. Test files create their own app instances against
 * these containers with unique (random) data per file.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const postgres = await new PostgreSqlContainer('postgres:17-alpine').start();
  const redis = await new RedisContainer('redis:8-alpine').start();

  const testEnv = {
    ROLE: 'all',
    NODE_ENV: 'test',
    // The app never listens in tests (requests go through fastify inject).
    PORT: '4999',
    LOG_LEVEL: 'silent',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    BETTER_AUTH_URL: 'http://localhost:0',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    INTERNAL_GRPC_TOKEN: randomBytes(32).toString('hex'),
    // Suites that exercise the local test receiver override this to 'true'.
    ALLOW_INSECURE_ENDPOINTS: 'false',
  };
  writeFileSync(ENV_FILE, JSON.stringify(testEnv));

  const pool = new Pool({ connectionString: testEnv.DATABASE_URL, max: 2 });
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  await pool.end();

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
