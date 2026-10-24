import type { DynamicModule } from '@nestjs/common';

import { DeliveryQueue } from './delivery-queue.js';

let cachedModule: DynamicModule | undefined;

/**
 * Just the enqueue side (BullMQ queue over the platform Redis). Imported by
 * the events module (post-commit enqueue) and the api role; carries no
 * feature-module imports, so there are no import cycles.
 */
export class DeliveryQueueModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: DeliveryQueueModule,
      providers: [DeliveryQueue],
      exports: [DeliveryQueue],
    };
    return cachedModule;
  }
}
