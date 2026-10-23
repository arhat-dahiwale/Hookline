import { Injectable } from '@nestjs/common';
import { newId } from '@hookline/shared';

import { createHash } from 'node:crypto';

import { and, desc, eq, lt, gt, sql } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
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
    const [row] = await this.database.db
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
}
