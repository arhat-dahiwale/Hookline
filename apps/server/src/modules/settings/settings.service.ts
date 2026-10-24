import { Injectable } from '@nestjs/common';

import type { TenantScope } from '../platform/database/tenant-scope.js';
import { AuditService } from '../audit/index.js';
import { SettingsRepository } from './settings.repository.js';

export interface OrgSettings {
  /** null = system default (RETENTION_DAYS env). */
  retentionDays: number | null;
}

/**
 * Org-level settings (API.md settings.get/update). Updates are audited.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  async get(scope: TenantScope): Promise<OrgSettings> {
    const row = await this.repository.find(scope);
    return { retentionDays: row?.retentionDays ?? null };
  }

  async update(
    scope: TenantScope,
    patch: { retentionDays: number | null },
    actor: { type: 'user' | 'api_key' | 'system'; id?: string },
  ): Promise<OrgSettings> {
    await this.repository.upsert(scope, patch);
    await this.audit.write({
      organizationId: scope.organizationId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'settings.updated',
      targetType: 'organization',
      targetId: scope.organizationId,
      metadata: { retentionDays: patch.retentionDays },
    });
    return this.get(scope);
  }
}
