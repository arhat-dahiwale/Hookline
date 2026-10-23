import type { DynamicModule } from '@nestjs/common';

import { EventsRepository } from './events.repository.js';

/** Events service (ingestion, fan-out) lands in Phase 4; the repository
 * exists from Phase 3 for schema ownership. */
export class EventsModule {
  static forRoot(): DynamicModule {
    return {
      module: EventsModule,
      providers: [EventsRepository],
      exports: [EventsRepository],
    };
  }
}
