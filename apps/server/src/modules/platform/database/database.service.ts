import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/**
 * Postgres access (Drizzle over a pg pool). Postgres is the source of truth;
 * the pool is closed on shutdown. Schema (tables) is attached in Phase 2/3.
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;
  readonly db: NodePgDatabase;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const poolConfig: PoolConfig = {
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: false,
    };
    this.pool = new Pool(poolConfig);
    this.db = drizzle(this.pool);
    // Idle clients can be killed by the server (restarts, admin commands);
    // an unhandled 'error' on the pool would crash the process.
    this.pool.on('error', (error: Error) => {
      this.logger.error(`idle postgres client error: ${error.message}`);
    });
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
