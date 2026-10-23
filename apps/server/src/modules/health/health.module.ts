import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

export class HealthModule {
  static forRoot() {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [HealthService],
    };
  }
}
