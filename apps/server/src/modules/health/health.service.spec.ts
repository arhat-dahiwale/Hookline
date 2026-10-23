import { describe, expect, it } from 'vitest';

import type { DatabaseService } from '../platform/database/database.service.js';
import { AppError } from '../platform/errors/app-error.js';
import type { RedisService } from '../platform/redis/redis.service.js';
import type { ShutdownService } from '../platform/shutdown/shutdown.service.js';
import { HealthService } from './health.service.js';

function makeService(
  overrides: {
    postgresOk?: boolean;
    redisOk?: boolean;
    shuttingDown?: boolean;
  } = {},
) {
  const postgresOk = overrides.postgresOk ?? true;
  const redisOk = overrides.redisOk ?? true;
  const database = {
    ping: async () => {
      if (!postgresOk) throw new Error('down');
    },
  };
  const redis = {
    ping: async () => {
      if (!redisOk) throw new Error('down');
    },
  };
  const shutdown = { isShuttingDown: overrides.shuttingDown ?? false };
  return new HealthService(
    database as unknown as DatabaseService,
    redis as unknown as RedisService,
    shutdown as unknown as ShutdownService,
  );
}

describe('HealthService.checkReadiness', () => {
  it('is ok when postgres and redis answer', async () => {
    await expect(makeService().checkReadiness()).resolves.toEqual({ status: 'ok' });
  });

  it('throws unavailable when postgres is down', async () => {
    const promise = makeService({ postgresOk: false }).checkReadiness();
    await expect(promise).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('unavailable');
      expect(appError.status).toBe(503);
      expect(appError.details).toEqual([{ path: 'postgres', message: 'down' }]);
      return true;
    });
  });

  it('throws unavailable when redis is down', async () => {
    await expect(makeService({ redisOk: false }).checkReadiness()).rejects.toMatchObject({
      code: 'unavailable',
      details: [{ path: 'redis' }],
    });
  });

  it('reports both failing dependencies', async () => {
    const promise = makeService({ postgresOk: false, redisOk: false }).checkReadiness();
    await expect(promise).rejects.toMatchObject({
      details: [{ path: 'postgres' }, { path: 'redis' }],
    });
  });

  it('fails while shutting down even if dependencies are healthy', async () => {
    await expect(makeService({ shuttingDown: true }).checkReadiness()).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
