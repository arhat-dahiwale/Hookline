import { Controller, Get } from '@nestjs/common';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Process is up. Never touches dependencies. */
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Postgres + Redis reachable and not shutting down, else 503. */
  @Get('ready')
  async ready(): Promise<{ status: string }> {
    return this.health.checkReadiness();
  }
}
