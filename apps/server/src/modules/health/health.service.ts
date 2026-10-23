import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../platform/database/database.service.js';
import { unavailable } from '../platform/errors/app-error.js';
// Value import (not `import type`): Nest DI needs the class reference in
// constructor param metadata.
import { RedisService } from '../platform/redis/redis.service.js';
import { ShutdownService } from '../platform/shutdown/shutdown.service.js';

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout(promise: Promise<void>, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} check timed out`)), CHECK_TIMEOUT_MS);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly shutdown: ShutdownService,
  ) {}

  /**
   * Ready only when Postgres and Redis answer and the process is not
   * shutting down. Failures map to 503 `unavailable` with check details.
   */
  async checkReadiness(): Promise<{ status: 'ok' }> {
    if (this.shutdown.isShuttingDown) {
      throw unavailable('shutting down');
    }

    const [postgresError, redisError] = await Promise.all([
      withTimeout(this.database.ping(), 'postgres').then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
      withTimeout(this.redis.ping(), 'redis').then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    ]);

    const failing = [
      postgresError !== null ? { path: 'postgres', message: postgresError } : null,
      redisError !== null ? { path: 'redis', message: redisError } : null,
    ].filter((entry): entry is { path: string; message: string } => entry !== null);

    if (failing.length > 0) {
      throw unavailable('dependencies not reachable', failing);
    }
    return { status: 'ok' };
  }
}
