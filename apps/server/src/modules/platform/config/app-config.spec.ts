import { describe, expect, it } from 'vitest';

import { InvalidConfigError, parseEnv } from './app-config.js';

function validEnv(): Record<string, string> {
  return {
    ROLE: 'all',
    NODE_ENV: 'development',
    PORT: '4000',
    DATABASE_URL: 'postgresql://hookline:pw@localhost:5432/hookline',
    REDIS_URL: 'redis://localhost:6379',
    BETTER_AUTH_SECRET: 'a'.repeat(44),
    BETTER_AUTH_URL: 'http://localhost:4000',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    INTERNAL_GRPC_TOKEN: '0123456789abcdef0123456789abcdef',
  };
}

describe('parseEnv', () => {
  it('parses a valid environment', () => {
    const config = parseEnv(validEnv());
    expect(config.ROLE).toBe('all');
    expect(config.PORT).toBe(4000);
    expect(config.DATABASE_URL).toContain('postgres');
  });

  it('applies documented defaults', () => {
    const env = validEnv();
    delete env.ROLE;
    delete env.PORT;
    delete env.LOG_LEVEL;
    delete env.ALLOW_INSECURE_ENDPOINTS;
    const config = parseEnv(env);
    expect(config.ROLE).toBe('all');
    expect(config.PORT).toBe(4000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.ALLOW_INSECURE_ENDPOINTS).toBe(false);
  });

  it('fails fast on an invalid ROLE', () => {
    const env = { ...validEnv(), ROLE: 'cron' };
    expect(() => parseEnv(env)).toThrow(InvalidConfigError);
    expect(() => parseEnv(env)).toThrow(/ROLE/);
  });

  it('fails fast on a missing DATABASE_URL', () => {
    const env = validEnv();
    delete env.DATABASE_URL;
    expect(() => parseEnv(env)).toThrow(/DATABASE_URL/);
  });

  it('fails fast when ENCRYPTION_KEY is not 32 bytes', () => {
    const env = { ...validEnv(), ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') };
    expect(() => parseEnv(env)).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects non-postgres database URLs', () => {
    const env = { ...validEnv(), DATABASE_URL: 'mysql://localhost/hookline' };
    expect(() => parseEnv(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a short Better Auth secret', () => {
    const env = { ...validEnv(), BETTER_AUTH_SECRET: 'tooshort' };
    expect(() => parseEnv(env)).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('coerces booleans from strings', () => {
    expect(
      parseEnv({ ...validEnv(), ALLOW_INSECURE_ENDPOINTS: 'true' }).ALLOW_INSECURE_ENDPOINTS,
    ).toBe(true);
    expect(
      parseEnv({ ...validEnv(), ALLOW_INSECURE_ENDPOINTS: 'false' }).ALLOW_INSECURE_ENDPOINTS,
    ).toBe(false);
  });
});
