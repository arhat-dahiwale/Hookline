import type { DynamicModule } from '@nestjs/common';

import { DeliveriesRepository } from './deliveries.repository.js';

/** Deliveries service (lifecycle, replay) lands in Phase 4/5; the repository
 * exists from Phase 3 for schema ownership. */
export class DeliveriesModule {
  static forRoot(): DynamicModule {
    return {
      module: DeliveriesModule,
      providers: [DeliveriesRepository],
      exports: [DeliveriesRepository],
    };
  }
}
