import { Injectable } from '@nestjs/common';
import { newId } from '@hookline/shared';

import { and, desc, eq } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import { TenantScope } from '../platform/database/tenant-scope.js';
import { auditLogs } from './audit.schema.js';

export type AuditActorType = 'user' | 'api_key' | 'system';

export interface AuditEntry {
  organizationId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Never contains secrets (AGENTS.md hard rule). */
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit trail for security-relevant actions (FR-37). Entries are
 * immutable; there is no update or delete path by design.
 */
@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async write(entry: AuditEntry): Promise<void> {
    await this.database.db.insert(auditLogs).values({
      id: newId('aud'),
      organizationId: entry.organizationId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
  }

  /** Newest first, tenant-scoped. */
  async list(scope: TenantScope, limit: number) {
    return this.database.db
      .select()
      .from(auditLogs)
      .where(scope.whereColumn(auditLogs.organizationId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }

  async findByAction(scope: TenantScope, action: string, limit = 10) {
    return this.database.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), scope.whereColumn(auditLogs.organizationId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }
}
