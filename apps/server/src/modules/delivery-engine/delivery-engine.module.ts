import type { DynamicModule } from '@nestjs/common';

import { DeliveriesModule } from '../deliveries/index.js';
import { EndpointsModule } from '../endpoints/index.js';
import { EventsModule } from '../events/index.js';
import { ObservabilityModule } from '../observability/index.js';
import { CircuitBreakerService } from './breaker.js';
import { DeliveryProcessor } from './delivery-processor.js';
import { DeliveryQueueModule } from '../delivery-queue/index.js';
import { ApiKeysModule } from '../api-keys/index.js';
import { DeliveryWorkerBootstrap } from './delivery-worker.bootstrap.js';
import { WorkerOperations } from './test-endpoint.js';
import { WorkerTestController } from './worker-test.controller.js';
import { MaintenanceService } from './maintenance.js';

let cachedModule: DynamicModule | undefined;

/** Cached: imported by both the api role (enqueue) and worker (processor). */
export class DeliveryEngineModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: DeliveryEngineModule,
      imports: [
        ObservabilityModule.forRole('api'),
        ApiKeysModule.forRoot(),
        DeliveryQueueModule.forRoot(),
        DeliveriesModule.forRoot(),
        EndpointsModule.forRoot(),
        EventsModule.forRoot(),
      ],
      providers: [
        DeliveryProcessor,
        CircuitBreakerService,
        MaintenanceService,
        WorkerOperations,
        DeliveryWorkerBootstrap,
      ],
      controllers: [WorkerTestController],
      exports: [DeliveryProcessor, CircuitBreakerService, MaintenanceService, WorkerOperations],
    };
    return cachedModule;
  }
}
