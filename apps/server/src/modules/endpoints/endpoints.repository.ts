import { Injectable } from '@nestjs/common';
import { newId } from '@hookline/shared';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import type { TransactionHandle } from '../platform/database/unit-of-work.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import { endpointHealth, endpoints } from './endpoints.schema.js';

export type EndpointRow = typeof endpoints.$inferSelect;
export type NewEndpoint = typeof endpoints.$inferInsert;
export type EndpointHealthRow = typeof endpointHealth.$inferSelect;

@Injectable()
export class EndpointsRepository {
  constructor(private readonly database: DatabaseService) {}

  async insert(input: Omit<NewEndpoint, 'id'>): Promise<EndpointRow> {
    const [row] = await this.database.db
      .insert(endpoints)
      .values({ ...input, id: newId('end') })
      .returning();
    return row!;
  }

  async ensureHealthRow(endpointId: string): Promise<void> {
    await this.database.db
      .insert(endpointHealth)
      .values({ endpointId })
      .onConflictDoNothing({ target: endpointHealth.endpointId });
  }

  /** Soft-delete-aware lookup, tenant-scoped. */
  async findById(scope: TenantScope, id: string): Promise<EndpointRow | null> {
    const [row] = await this.database.db
      .select()
      .from(endpoints)
      .where(
        and(
          eq(endpoints.id, id),
          scope.whereColumn(endpoints.organizationId),
          isNull(endpoints.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Includes soft-deleted rows (needed by the delivery engine for history). */
  async findByIdUnscoped(id: string): Promise<EndpointRow | null> {
    const [row] = await this.database.db
      .select()
      .from(endpoints)
      .where(eq(endpoints.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Fan-out matching within the caller's transaction (UnitOfWork): active,
   * non-deleted endpoints whose event-type filter matches. Empty filter
   * matches everything; filters support exact types and `prefix.*`.
   */
  async listActiveForEventTx(
    tx: TransactionHandle,
    scope: TenantScope,
    eventType: string,
    endpointIds?: string[],
  ): Promise<EndpointRow[]> {
    const rows = await tx
      .select()
      .from(endpoints)
      .where(
        and(
          scope.whereColumn(endpoints.organizationId),
          isNull(endpoints.deletedAt),
          eq(endpoints.status, 'active'),
        ),
      );
    return rows.filter((row) => {
      if (endpointIds && !endpointIds.includes(row.id)) return false;
      if (row.eventTypes.length === 0) return true;
      return row.eventTypes.some(
        (pattern) =>
          pattern === eventType ||
          (pattern.endsWith('.*') && eventType.startsWith(pattern.slice(0, -1))),
      );
    });
  }

  async listActive(scope: TenantScope): Promise<EndpointRow[]> {
    return this.database.db
      .select()
      .from(endpoints)
      .where(
        and(
          scope.whereColumn(endpoints.organizationId),
          isNull(endpoints.deletedAt),
          eq(endpoints.status, 'active'),
        ),
      )
      .orderBy(desc(endpoints.createdAt));
  }

  async listAll(scope: TenantScope): Promise<EndpointRow[]> {
    return this.database.db
      .select()
      .from(endpoints)
      .where(and(scope.whereColumn(endpoints.organizationId), isNull(endpoints.deletedAt)))
      .orderBy(desc(endpoints.createdAt));
  }

  async update(
    scope: TenantScope,
    id: string,
    patch: Partial<NewEndpoint>,
  ): Promise<EndpointRow | null> {
    const [row] = await this.database.db
      .update(endpoints)
      .set(patch)
      .where(
        and(
          eq(endpoints.id, id),
          scope.whereColumn(endpoints.organizationId),
          isNull(endpoints.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async softDelete(scope: TenantScope, id: string): Promise<EndpointRow | null> {
    return this.update(scope, id, {
      deletedAt: new Date(),
      status: 'disabled',
      disabledReason: 'manual',
    });
  }

  async upsertHealth(
    endpointId: string,
    patch: Partial<typeof endpointHealth.$inferInsert>,
  ): Promise<EndpointHealthRow> {
    const [row] = await this.database.db
      .insert(endpointHealth)
      .values({ endpointId, ...patch })
      .onConflictDoUpdate({ target: endpointHealth.endpointId, set: patch })
      .returning();
    return row!;
  }

  async findHealth(endpointId: string): Promise<EndpointHealthRow | null> {
    const [row] = await this.database.db
      .select()
      .from(endpointHealth)
      .where(eq(endpointHealth.endpointId, endpointId))
      .limit(1);
    return row ?? null;
  }
}
