import {
  Inject,
  Injectable,
  Logger,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import type { Role } from '../../app.module.js';
import { DeliveriesModule } from '../deliveries/index.js';
import { DeliveryEngineModule } from '../delivery-engine/index.js';
import { EndpointsModule } from '../endpoints/index.js';
import { EventsModule } from '../events/index.js';
import { GrpcWorkerOperations } from './grpc-operations.js';
import { InProcessWorkerOperations } from './in-process-operations.js';
import { WorkerGrpcServer } from './grpc-server.js';
import { WORKER_OPERATIONS } from './worker-operations.js';

/**
 * Starts the internal gRPC server in the roles that EXECUTE deliveries
 * (worker/all). The api role only ever runs the client adapter.
 */
@Injectable()
export class WorkerOpsBootstrap implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerOpsBootstrap.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly grpcServer: WorkerGrpcServer,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.ROLE === 'api') return;
    void this.grpcServer.start().catch((error: unknown) => {
      this.logger.error(
        `worker gRPC server failed to start: ${error instanceof Error ? error.message : error}`,
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.config.ROLE === 'api') return;
    await this.grpcServer.stop().catch(() => undefined);
  }
}

/**
 * Provides the active worker-operations adapter (ARCHITECTURE.md 5.4):
 * in-process for worker/all, gRPC client for the api role. Both implement
 * the same WorkerOperationsService interface. APP_CONFIG is global, so the
 * adapters resolve it without importing PlatformModule.
 */
export class WorkerOpsModule {
  static forRole(role: Role): DynamicModule {
    const adapter: Provider =
      role === 'api'
        ? { provide: WORKER_OPERATIONS, useClass: GrpcWorkerOperations }
        : { provide: WORKER_OPERATIONS, useClass: InProcessWorkerOperations };
    return {
      module: WorkerOpsModule,
      imports: [
        DeliveryEngineModule.forRoot(),
        DeliveriesModule.forRoot(),
        EventsModule.forRoot(),
        EndpointsModule.forRoot(),
      ],
      providers: [adapter, WorkerGrpcServer, WorkerOpsBootstrap],
      exports: [WORKER_OPERATIONS],
    };
  }
}
