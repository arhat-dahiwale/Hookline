import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Org-level dashboard settings (API.md settings.get/update). One row per
 * organization; nullable fields fall back to system defaults (env).
 */
export const orgSettings = pgTable('org_settings', {
  organizationId: text('organization_id').primaryKey(),
  /** Retention override in days; null = system default (RETENTION_DAYS). */
  retentionDays: integer('retention_days'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrgSettingsRow = typeof orgSettings.$inferSelect;
export type NewOrgSettingsRow = typeof orgSettings.$inferInsert;
