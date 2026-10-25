import { router } from './trpc.js';
import { createEndpointsRouter } from './endpoints.router.js';
import { createEventsRouter } from './events.router.js';
import { createDeliveriesRouter } from './deliveries.router.js';
import { createApiKeysRouter } from './api-keys.router.js';
import { createAuditRouter } from './audit.router.js';
import { createSettingsRouter } from './settings.router.js';
import { createStatsRouter } from './stats.router.js';
import type { AppConfig } from '../platform/config/app-config.js';
import { EndpointsRepository, EndpointsService } from '../endpoints/index.js';
import { DeliveriesRepository, DeliveriesService } from '../deliveries/index.js';
import { EventsService } from '../events/index.js';
import { ApiKeysService } from '../api-keys/index.js';
import { AuditService } from '../audit/index.js';
import { SettingsService } from '../settings/index.js';
import { AnalyticsService } from '../analytics/index.js';
import type { WorkerOperationsService } from '../worker-ops/index.js';

export interface AppRouterDeps {
  config: AppConfig;
  endpointsService: EndpointsService;
  endpointsRepository: EndpointsRepository;
  deliveriesRepository: DeliveriesRepository;
  deliveriesService: DeliveriesService;
  eventsService: EventsService;
  apiKeysService: ApiKeysService;
  auditService: AuditService;
  settingsService: SettingsService;
  analyticsService: AnalyticsService;
  getWorkerOperations: () => WorkerOperationsService | null;
}

/** Root tRPC router (API.md section 3). Routers nest under their API names. */
export function createAppRouter(deps: AppRouterDeps) {
  return router({
    endpoints: createEndpointsRouter(deps),
    events: createEventsRouter(deps),
    deliveries: createDeliveriesRouter(deps),
    apiKeys: createApiKeysRouter(deps),
    audit: createAuditRouter(deps),
    settings: createSettingsRouter(deps),
    stats: createStatsRouter(deps),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
