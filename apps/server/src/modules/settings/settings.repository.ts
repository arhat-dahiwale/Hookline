import { Injectable } from '@nestjs/common';

import { eq } from 'drizzle-orm';

import { DatabaseService } from '../platform/database/database.service.js';
import type { TenantScope } from '../platform/database/tenant-scope.js';
import { orgSettings, type OrgSettingsRow } from './settings.schema.js';

@Injectable()
export class SettingsRepository {
  constructor(private readonly database: DatabaseService) {}

  async find(scope: TenantScope): Promise<OrgSettingsRow | null> {
    const [row] = await this.database.db
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.organizationId, scope.organizationId))
      .limit(1);
    return row ?? null;
  }

  async upsert(
    scope: TenantScope,
    patch: { retentionDays: number | null },
  ): Promise<OrgSettingsRow> {
    const [row] = await this.database.db
      .insert(orgSettings)
      .values({
        organizationId: scope.organizationId,
        retentionDays: patch.retentionDays,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: orgSettings.organizationId,
        set: { retentionDays: patch.retentionDays, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }
}
