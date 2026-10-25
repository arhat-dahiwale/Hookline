import { Injectable } from '@nestjs/common';
import { newId } from '@hookline/shared';

import { createHash } from 'node:crypto';

import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import type { TransactionHandle } from '../platform/database/unit-of-work.js';
import { events } from './events.schema.js';

export type EventRow = typeof events.$inferSelect;

/** Canonical JSON: sorted keys, no whitespace — stable payload hashing. */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`;
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonicalizeJson(payload)).digest('hex');
}

@Injectable()
export class EventsRepository {
  constructor(private readonly database: DatabaseService) {}

  async insert(input: {
    organizationId: string;
    type: string;
    payload: unknown;
    idempotencyKey?: string | null;
  }): Promise<EventRow> {
    return this.insertTx(this.database.db as unknown as TransactionHandle, input);
  }

  /** Insert inside the ingestion transaction (UnitOfWork). */
  async insertTx(
    tx: TransactionHandle,
    input: {
      organizationId: string;
      type: string;
      payload: unknown;
      idempotencyKey?: string | null;
    },
  ): Promise<EventRow> {
    const [row] = await tx
      .insert(events)
      .values({
        id: newId('evt'),
        organizationId: input.organizationId,
        type: input.type,
        payload: input.payload as object,
        payloadHash: payloadHash(input.payload),
        idempotencyKey: input.idempotencyKey ?? null,
      })
      .returning();
    return row!;
  }

  /** Returns the existing row for an idempotency key, if any. */
  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<EventRow | null> {
    const [row] = await this.database.db
      .select()
      .from(events)
      .where(
        and(eq(events.organizationId, organizationId), eq(events.idempotencyKey, idempotencyKey)),
      )
      .limit(1);
    return row ?? null;
  }

  async findById(scope: TenantScope, id: string): Promise<EventRow | null> {
    const [row] = await this.database.db
      .select()
      .from(events)
      .where(and(eq(events.id, id), scope.whereColumn(events.organizationId)))
      .limit(1);
    return row ?? null;
  }

  async list(
    scope: TenantScope,
    filters: { type?: string; from?: Date; to?: Date },
    limit: number,
    cursor?: { createdAt: Date; id: string } | null,
  ): Promise<EventRow[]> {
    const conditions = [scope.whereColumn(events.organizationId)];
    if (filters.type) conditions.push(eq(events.type, filters.type));
    if (filters.from) conditions.push(gt(events.createdAt, filters.from));
    if (filters.to) conditions.push(lt(events.createdAt, filters.to));
    if (cursor) {
      conditions.push(
        sql`(${events.createdAt}, ${events.id}) < (${cursor.createdAt.toISOString()}, ${cursor.id})`,
      );
    }
    return this.database.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.createdAt), desc(events.id))
      .limit(limit);
  }

  /**
   * Retention cleanup (Phase 11): deletes up to `limit` events older than
   * the cutoff for one organization. Deliveries and attempts cascade (FKs).
   * Returns the number of deleted rows.
   */
  async deleteOlderThan(organizationId: string, cutoff: Date, limit: number): Promise<number> {
    const batch = await this.database.db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.organizationId, organizationId), lt(events.createdAt, cutoff)))
      .orderBy(asc(events.createdAt))
      .limit(limit);
    if (batch.length === 0) return 0;
    const deleted = await this.database.db
      .delete(events)
      .where(
        inArray(
          events.id,
          batch.map((row) => row.id),
        ),
      )
      .returning({ id: events.id });
    return deleted.length;
  }

  /** Distinct org ids with events (retention default pass). */
  async listDistinctOrgIds(): Promise<string[]> {
    const rows = await this.database.db
      .selectDistinct({ organizationId: events.organizationId })
      .from(events);
    return rows.map((row) => row.organizationId);
  }
}
