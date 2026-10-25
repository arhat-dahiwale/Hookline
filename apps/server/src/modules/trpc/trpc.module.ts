import type { DynamicModule } from '@nestjs/common';

import { ApiKeysModule } from '../api-keys/index.js';
import { AuditModule } from '../audit/index.js';
import { AuthModule } from '../auth/index.js';
import { DeliveriesModule } from '../deliveries/index.js';
import { EndpointsModule } from '../endpoints/index.js';
import { EventsModule } from '../events/index.js';
import { SettingsModule } from '../settings/index.js';
import { AnalyticsModule } from '../analytics/index.js';
import { TrpcContextFactory } from './trpc-context.factory.js';

/**
 * tRPC protocol layer (API.md section 3). HTTP-serving roles only; routes
 * register via `registerTrpcRoutes` from main.ts once the app exists.
 */
export class TrpcModule {
  static forRoot(): DynamicModule {
    return {
      module: TrpcModule,
      imports: [
        AuthModule.forRoot(),
        EndpointsModule.forRoot(),
        DeliveriesModule.forRoot(),
        EventsModule.forRoot(),
        ApiKeysModule.forRoot(),
        AuditModule.forRoot(),
        SettingsModule.forRoot(),
        AnalyticsModule.forRole('api'),
      ],
      providers: [TrpcContextFactory],
      exports: [TrpcContextFactory],
    };
  }
}
