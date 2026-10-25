import type { DynamicModule } from '@nestjs/common';

import { AuthModule } from '../auth/index.js';
import { EndpointsModule } from '../endpoints/index.js';
import { EventsModule } from '../events/index.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeService } from './realtime.service.js';

let cachedModule: DynamicModule | undefined;

/**
 * Real-time module (ARCHITECTURE.md 7.4, API.md section 4). Loaded in every
 * role: workers publish bus events to Redis; APIs fan out to local sockets.
 */
export class RealtimeModule {
  static forRoot(): DynamicModule {
    if (cachedModule) return cachedModule;
    cachedModule = {
      module: RealtimeModule,
      imports: [AuthModule.forRoot(), EndpointsModule.forRoot(), EventsModule.forRoot()],
      providers: [RealtimeService, RealtimeGateway],
      exports: [RealtimeService],
    };
    return cachedModule;
  }
}
