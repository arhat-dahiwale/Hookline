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
  private readonly url: string;
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.url = config.REDIS_URL;
    this.client = new Redis(this.url, {
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

  /**
   * Fresh connection for BullMQ, built from the URL: `maxRetriesPerRequest:
   * null` is required by BullMQ, and no command timeout may be inherited —
   * BullMQ issues long blocking commands that a 5s timeout would abort.
   */
  duplicateForBullMq(): Redis {
    return new Redis(this.url, {
      maxRetriesPerRequest: null,
      enableAutoPipelining: false,
    });
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
