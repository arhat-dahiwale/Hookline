import { Injectable } from '@nestjs/common';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Value import: Nest DI needs the class in constructor param metadata.
import { DatabaseService } from './database.service.js';

/**
 * Cross-module transactions (ARCHITECTURE.md section 4): the only sanctioned
 * way to share a transaction between modules. Receivers use the typed handle
 * for their own tables only.
 */
export type TransactionHandle = NodePgDatabase;

@Injectable()
export class UnitOfWork {
  constructor(private readonly database: DatabaseService) {}

  async run<T>(work: (tx: TransactionHandle) => Promise<T>): Promise<T> {
    return this.database.db.transaction(async (tx) => work(tx as TransactionHandle));
  }
}
