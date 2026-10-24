import { router } from './trpc.js';
import { createEndpointsRouter } from './endpoints.router.js';
import type { AppConfig } from '../platform/config/app-config.js';
import { EndpointsRepository, EndpointsService } from '../endpoints/index.js';
import { DeliveriesRepository } from '../deliveries/index.js';
import type { WorkerOperations } from '../delivery-engine/index.js';

export interface AppRouterDeps {
  config: AppConfig;
  endpointsService: EndpointsService;
  endpointsRepository: EndpointsRepository;
  deliveriesRepository: DeliveriesRepository;
  getWorkerOperations: () => WorkerOperations | null;
}

/** Root tRPC router (API.md section 3). Routers nest under their API names. */
export function createAppRouter(deps: AppRouterDeps) {
  return router({
    endpoints: createEndpointsRouter(deps),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
