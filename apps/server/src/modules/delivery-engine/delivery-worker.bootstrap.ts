import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { DeliveryProcessor } from './delivery-processor.js';

/**
 * Starts BullMQ workers only in the roles that process deliveries:
 * `worker` and `all`. The `api` role loads the module for enqueueing but
 * never starts a processor.
 */
@Injectable()
export class DeliveryWorkerBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeliveryWorkerBootstrap.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly processor: DeliveryProcessor,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.ROLE === 'api') return;
    this.processor.start(this.config.DELIVERY_CONCURRENCY);
    this.logger.log(`delivery worker started (concurrency ${this.config.DELIVERY_CONCURRENCY})`);
  }
}
