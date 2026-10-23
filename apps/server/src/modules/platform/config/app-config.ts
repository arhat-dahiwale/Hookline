import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenvFile } from 'dotenv';
import { ZodError } from 'zod';

import { envSchema, type Env } from './env.schema.js';

export type AppConfig = Env;

/** Injection token for the parsed, validated application config. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Reads the local `.env` (repo root or cwd) without overriding variables that
 * are already set in the environment. Compose, tests and CI inject env vars
 * directly and win over the file.
 */
export function loadEnvFile(): Record<string, string> {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const path of candidates) {
    if (existsSync(path)) {
      return loadDotenvFile({ path, quiet: true }).parsed ?? {};
    }
  }
  return {};
}

export class InvalidConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Validates raw environment variables against the schema. Pure: unit tests
 * call this directly with explicit inputs.
 */
export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  try {
    return envSchema.parse(env);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new InvalidConfigError(
        error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      );
    }
    throw error;
  }
}

/** Loads .env (non-overriding), merges process.env, validates. Fail fast. */
export function loadAppConfig(): AppConfig {
  return parseEnv({ ...loadEnvFile(), ...process.env });
}
