import { Injectable } from '@nestjs/common';
import { newId } from '@hookline/shared';

import { and, asc, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import type { TransactionHandle } from '../platform/database/unit-of-work.js';
import { deliveryAttempts, deliveries } from './deliveries.schema.js';

export type DeliveryRow = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
export type DeliveryAttemptRow = typeof deliveryAttempts.$inferSelect;
export type NewDeliveryAttempt = typeof deliveryAttempts.$inferInsert;

@Injectable()
export class DeliveriesRepository {
  constructor(private readonly database: DatabaseService) {}

  async insertMany(rows: Omit<NewDelivery, 'id'>[]): Promise<DeliveryRow[]> {
    if (rows.length === 0) return [];
    return this.database.db
      .insert(deliveries)
      .values(rows.map((row) => ({ ...row, id: newId('dlv') })))
      .returning();
  }

  /** Fan-out insert inside the ingestion transaction (UnitOfWork). */
  async insertManyTx(
    tx: TransactionHandle,
    rows: Omit<NewDelivery, 'id'>[],
  ): Promise<DeliveryRow[]> {
    if (rows.length === 0) return [];
    return tx
      .insert(deliveries)
      .values(rows.map((row) => ({ ...row, id: newId('dlv') })))
      .returning();
  }

  async findById(scope: TenantScope, id: string): Promise<DeliveryRow | null> {
    const [row] = await this.database.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.id, id), scope.whereColumn(deliveries.organizationId)))
      .limit(1);
    return row ?? null;
  }

  async findByIdUnscoped(id: string): Promise<DeliveryRow | null> {
    const [row] = await this.database.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(
    scope: TenantScope,
    filters: {
      status?: DeliveryRow['status'];
      endpointId?: string;
      eventId?: string;
      from?: Date;
      to?: Date;
    },
    limit: number,
    cursor?: { createdAt: Date; id: string } | null,
  ): Promise<DeliveryRow[]> {
    const conditions = [scope.whereColumn(deliveries.organizationId)];
    if (filters.status) conditions.push(eq(deliveries.status, filters.status));
    if (filters.endpointId) conditions.push(eq(deliveries.endpointId, filters.endpointId));
    if (filters.eventId) conditions.push(eq(deliveries.eventId, filters.eventId));
    if (filters.from) conditions.push(gte(deliveries.createdAt, filters.from));
    if (filters.to) conditions.push(lte(deliveries.createdAt, filters.to));
    if (cursor) {
      conditions.push(
        sql`(${deliveries.createdAt}, ${deliveries.id}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
      );
    }
    return this.database.db
      .select()
      .from(deliveries)
      .where(and(...conditions))
      .orderBy(desc(deliveries.createdAt), desc(deliveries.id))
      .limit(limit);
  }

  /**
   * Deliveries updated after a timestamp, oldest first (API.md deliveries.since
   * — the WebSocket reconnect backfill). Bounded by the caller's limit.
   */
  async listSince(scope: TenantScope, since: Date, limit: number): Promise<DeliveryRow[]> {
    return this.database.db
      .select()
      .from(deliveries)
      .where(and(scope.whereColumn(deliveries.organizationId), gt(deliveries.updatedAt, since)))
      .orderBy(asc(deliveries.updatedAt), asc(deliveries.id))
      .limit(limit);
  }

  /** Bulk replay feed: terminal-state deliveries matching a filter. */
  async listMatching(
    scope: TenantScope,
    filters: { status?: DeliveryRow['status']; endpointId?: string; from?: Date; to?: Date },
    limit: number,
  ): Promise<DeliveryRow[]> {
    const conditions = [scope.whereColumn(deliveries.organizationId)];
    if (filters.status) conditions.push(eq(deliveries.status, filters.status));
    if (filters.endpointId) conditions.push(eq(deliveries.endpointId, filters.endpointId));
    if (filters.from) conditions.push(gte(deliveries.createdAt, filters.from));
    if (filters.to) conditions.push(lte(deliveries.createdAt, filters.to));
    return this.database.db
      .select()
      .from(deliveries)
      .where(and(...conditions))
      .orderBy(desc(deliveries.createdAt))
      .limit(limit);
  }

  async listForEvent(scope: TenantScope, eventId: string): Promise<DeliveryRow[]> {
    return this.database.db
      .select()
      .from(deliveries)
      .where(and(scope.whereColumn(deliveries.organizationId), eq(deliveries.eventId, eventId)))
      .orderBy(desc(deliveries.createdAt));
  }

  async insertAttempt(
    row: Omit<NewDeliveryAttempt, 'id'>,
  ): Promise<{ row: DeliveryAttemptRow | null }> {
    const [inserted] = await this.database.db
      .insert(deliveryAttempts)
      .values({ ...row, id: newId('att') })
      .onConflictDoNothing({
        target: [deliveryAttempts.deliveryId, deliveryAttempts.attemptNumber],
      })
      .returning();
    return { row: inserted ?? null };
  }

  async findAttempts(deliveryId: string): Promise<DeliveryAttemptRow[]> {
    return this.database.db
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, deliveryId))
      .orderBy(asc(deliveryAttempts.attemptNumber));
  }

  /** Reconciler feed: pending deliveries older than the grace period. */
  async findStalePending(olderThan: Date, limit: number): Promise<DeliveryRow[]> {
    return this.database.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.status, 'pending'), lt(deliveries.createdAt, olderThan)))
      .orderBy(asc(deliveries.createdAt))
      .limit(limit);
  }

  /** Reconciler feed: retrying deliveries whose next attempt is overdue. */
  async findOverdueRetrying(before: Date, limit: number): Promise<DeliveryRow[]> {
    return this.database.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.status, 'retrying'), lt(deliveries.nextAttemptAt, before)))
      .orderBy(asc(deliveries.nextAttemptAt))
      .limit(limit);
  }

  /** 24h attempt stats for an endpoint's health panel (API.md endpoints/health). */
  async attemptStatsSince(
    endpointId: string,
    since: Date,
  ): Promise<{ attempts: number; succeeded: number; p95Ms: number }> {
    const [row] = await this.database.db
      .select({
        attempts: sql<number>`count(*)::int`,
        succeeded: sql<number>`count(*) filter (where ${deliveryAttempts.outcome} = 'success')::int`,
        p95Ms: sql<number>`coalesce(percentile_disc(0.95) within group (order by ${deliveryAttempts.durationMs}), 0)::int`,
      })
      .from(deliveryAttempts)
      .where(
        and(eq(deliveryAttempts.endpointId, endpointId), gte(deliveryAttempts.startedAt, since)),
      );
    return {
      attempts: row?.attempts ?? 0,
      succeeded: row?.succeeded ?? 0,
      p95Ms: row?.p95Ms ?? 0,
    };
  }

  /** Atomically claims the next attempt; null means someone else won. */
  async claimAttempt(deliveryId: string, expectedAttemptCount: number): Promise<number | null> {
    const attemptNumber = expectedAttemptCount + 1;
    const [row] = await this.database.db
      .update(deliveries)
      .set({
        status: 'in_progress',
        attemptCount: attemptNumber,
        lastAttemptAt: new Date(),
      })
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.attemptCount, expectedAttemptCount)))
      .returning({ attemptCount: deliveries.attemptCount });
    return row ? attemptNumber : null;
  }

  async markSucceeded(
    deliveryId: string,
    input: { attemptNumber: number; responseStatus: number | null; completedAt: Date },
  ): Promise<void> {
    await this.database.db
      .update(deliveries)
      .set({
        status: 'succeeded',
        completedAt: input.completedAt,
        lastResponseStatus: input.responseStatus,
        lastError: null,
      })
      .where(eq(deliveries.id, deliveryId));
  }

  async markDead(
    deliveryId: string,
    input: { responseStatus: number | null; lastError: string; completedAt: Date },
  ): Promise<void> {
    await this.database.db
      .update(deliveries)
      .set({
        status: 'dead',
        completedAt: input.completedAt,
        lastResponseStatus: input.responseStatus,
        lastError: input.lastError,
      })
      .where(eq(deliveries.id, deliveryId));
  }

  async markRetrying(
    deliveryId: string,
    input: { responseStatus: number | null; lastError: string; nextAttemptAt: Date },
  ): Promise<void> {
    await this.database.db
      .update(deliveries)
      .set({
        status: 'retrying',
        nextAttemptAt: input.nextAttemptAt,
        lastResponseStatus: input.responseStatus,
        lastError: input.lastError,
      })
      .where(eq(deliveries.id, deliveryId));
  }

  async markCancelled(deliveryId: string, lastError: string): Promise<void> {
    await this.database.db
      .update(deliveries)
      .set({ status: 'cancelled', completedAt: new Date(), lastError })
      .where(eq(deliveries.id, deliveryId));
  }

  async updateById(id: string, patch: Partial<NewDelivery>): Promise<DeliveryRow | null> {
    const [row] = await this.database.db
      .update(deliveries)
      .set(patch)
      .where(eq(deliveries.id, id))
      .returning();
    return row ?? null;
  }

  async countByStatus(scope: TenantScope, statuses: DeliveryRow['status'][]): Promise<number> {
    const rows = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(
        and(scope.whereColumn(deliveries.organizationId), inArray(deliveries.status, statuses)),
      );
    return rows[0]?.count ?? 0;
  }
}
