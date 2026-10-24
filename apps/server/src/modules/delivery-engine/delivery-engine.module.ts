import type { DynamicModule } from '@nestjs/common';

import { DeliveriesModule } from '../deliveries/index.js';
import { EndpointsModule } from '../endpoints/index.js';
import { EventsModule } from '../events/index.js';
import { CircuitBreakerService } from './breaker.js';
import { DeliveryProcessor } from './delivery-processor.js';
import { DeliveryQueueModule } from '../delivery-queue/index.js';
import { DeliveryWorkerBootstrap } from './delivery-worker.bootstrap.js';
import { MaintenanceService } from './maintenance.js';

let cachedModule: DynamicModule | undefined;

/** Cached: imported by both the api role (enqueue) and worker (processor). */
export class DeliveryEngineModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: DeliveryEngineModule,
      imports: [
        DeliveryQueueModule.forRoot(),
        DeliveriesModule.forRoot(),
        EndpointsModule.forRoot(),
        EventsModule.forRoot(),
      ],
      providers: [
        DeliveryProcessor,
        CircuitBreakerService,
        MaintenanceService,
        DeliveryWorkerBootstrap,
      ],
      exports: [DeliveryProcessor, CircuitBreakerService, MaintenanceService],
    };
    return cachedModule;
  }
}
