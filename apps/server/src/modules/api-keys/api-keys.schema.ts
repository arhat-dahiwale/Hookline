import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { uniqueIndex } from 'drizzle-orm/pg-core';

export const API_KEY_SCOPES = [
  'events:write',
  'events:read',
  'endpoints:read',
  'endpoints:write',
  'deliveries:read',
  'deliveries:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text().primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text().notNull(),
    prefix: text().notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text().array().notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_keys_prefix_uidx').on(table.prefix),
    index('api_keys_org_idx').on(table.organizationId),
  ],
);
