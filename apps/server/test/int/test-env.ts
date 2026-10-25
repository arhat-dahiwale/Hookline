import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE = resolve(process.cwd(), 'test/int/.testenv.json');

export interface TestEnv {
  ROLE: 'all';
  NODE_ENV: 'test';
  PORT: string;
  LOG_LEVEL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ENCRYPTION_KEY: string;
  INTERNAL_GRPC_TOKEN: string;
  ALLOW_INSECURE_ENDPOINTS: string;
  WORKER_GRPC_URL: string;
}

let cached: TestEnv | undefined;

/** Connection details written by the integration global setup. */
export function loadTestEnv(): TestEnv {
  if (cached) return cached;
  if (!existsSync(ENV_FILE)) {
    throw new Error('test env missing: run via `pnpm test:int` (global setup starts containers)');
  }
  cached = JSON.parse(readFileSync(ENV_FILE, 'utf8')) as TestEnv;
  return cached;
}
