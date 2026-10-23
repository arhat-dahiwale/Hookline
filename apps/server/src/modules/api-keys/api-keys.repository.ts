import { Injectable } from '@nestjs/common';
import { newId } from '@hookline/shared';

import { and, desc, eq } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import { apiKeys, type ApiKeyScope } from './api-keys.schema.js';

/**
 * Drizzle types text[] columns as string[]; scopes are validated against
 * API_KEY_SCOPES on insert, so this narrowed view is safe.
 */
export interface ApiKeyRow extends Omit<typeof apiKeys.$inferSelect, 'scopes'> {
  scopes: ApiKeyScope[];
}

@Injectable()
export class ApiKeysRepository {
  constructor(private readonly database: DatabaseService) {}

  async insert(input: {
    organizationId: string;
    name: string;
    prefix: string;
    keyHash: string;
    scopes: ApiKeyScope[];
    createdByUserId: string;
    expiresAt?: Date | null;
  }): Promise<ApiKeyRow> {
    const [row] = await this.database.db
      .insert(apiKeys)
      .values({
        id: newId('key'),
        organizationId: input.organizationId,
        name: input.name,
        prefix: input.prefix,
        keyHash: input.keyHash,
        scopes: input.scopes,
        createdByUserId: input.createdByUserId,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    return row as ApiKeyRow;
  }

  async findByPrefix(prefix: string): Promise<ApiKeyRow | null> {
    const [row] = await this.database.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.prefix, prefix))
      .limit(1);
    return (row as ApiKeyRow | undefined) ?? null;
  }

  async findById(scope: TenantScope, id: string): Promise<ApiKeyRow | null> {
    const [row] = await this.database.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), scope.whereColumn(apiKeys.organizationId)))
      .limit(1);
    return (row as ApiKeyRow | undefined) ?? null;
  }

  async list(scope: TenantScope): Promise<ApiKeyRow[]> {
    return this.database.db
      .select()
      .from(apiKeys)
      .where(scope.whereColumn(apiKeys.organizationId))
      .orderBy(desc(apiKeys.createdAt)) as Promise<ApiKeyRow[]>;
  }

  async revoke(scope: TenantScope, id: string): Promise<ApiKeyRow | null> {
    const [row] = await this.database.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), scope.whereColumn(apiKeys.organizationId)))
      .returning();
    return (row as ApiKeyRow | undefined) ?? null;
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    await this.database.db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
  }
}
