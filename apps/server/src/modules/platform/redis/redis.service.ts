import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

import Redis from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Shared Redis client. Holds caches, rate limiters and breaker state — never
 * the only copy of durable state. BullMQ gets separate connections via
 * `duplicateForBullMq()` because it requires `maxRetriesPerRequest: null`.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableAutoPipelining: true,
      commandTimeout: 5_000,
    });
    // Log connection-level errors so outages surface in logs without
    // crashing the process; readiness reports the outage as 503.
    this.client.on('error', (error: Error) => {
      this.logger.error(`redis connection error: ${error.message}`);
    });
  }

  /** New connection sharing the same config, tuned for BullMQ. */
  duplicateForBullMq(): Redis {
    return this.client.duplicate({ maxRetriesPerRequest: null, enableAutoPipelining: false });
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`unexpected PING reply: ${reply}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.client.disconnect();
  }
}
