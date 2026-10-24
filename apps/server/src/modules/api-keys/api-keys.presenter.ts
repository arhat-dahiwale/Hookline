import type { ApiKeyRow } from './api-keys.repository.js';

/**
 * Wire format for an API key: never includes the key hash or the full key —
 * the secret is returned exactly once by create (API.md).
 */
export function presentApiKey(key: ApiKeyRow) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}
