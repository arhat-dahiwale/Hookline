import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';

/**
 * Cooperative shutdown state. Flips as soon as SIGTERM/SIGINT starts the
 * shutdown sequence (before sockets close) so `/health/ready` starts failing
 * while in-flight work drains. Load balancers should stop routing on 503.
 */
@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  private shuttingDown = false;

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }
}
