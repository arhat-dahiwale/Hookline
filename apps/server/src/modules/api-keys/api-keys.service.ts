import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { TenantScope } from '../platform/database/tenant-scope.js';
import { notFound, unauthorized } from '../platform/errors/app-error.js';
import { RedisService } from '../platform/redis/redis.service.js';
import { AuditService } from '../audit/index.js';
import { API_KEY_SCOPES, type ApiKeyScope } from './api-keys.schema.js';
import { ApiKeysRepository, type ApiKeyRow } from './api-keys.repository.js';

const CACHE_TTL_SECONDS = 60;
const LAST_USED_THROTTLE_MS = 60_000;

export interface ResolvedApiKey {
  apiKeyId: string;
  organizationId: string;
  scopes: ApiKeyScope[];
}

interface CachedKey {
  id: string;
  organizationId: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  revoked: boolean;
  expiresAtIso: string | null;
}

function cacheKey(prefix: string): string {
  return `hl:apikey:${prefix}`;
}

export interface CreatedApiKey {
  key: ApiKeyRow;
  /** Full API key, returned exactly once at creation. */
  secret: string;
}

/**
 * API key lifecycle (ARCHITECTURE.md 7.2): keys are `hl_live_{prefix}_{secret}`,
 * stored as SHA-256 hashes, looked up by prefix through a 60s Redis cache
 * (DATA.md section 7) with Postgres as the source of truth.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);
  private readonly lastUsedAtFlushed = new Map<string, number>();

  constructor(
    private readonly repository: ApiKeysRepository,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async create(
    scope: TenantScope,
    input: {
      name: string;
      scopes: ApiKeyScope[];
      createdByUserId: string;
      expiresAt?: Date | null;
    },
  ): Promise<CreatedApiKey> {
    const invalid = input.scopes.find((s) => !API_KEY_SCOPES.includes(s));
    if (invalid !== undefined) {
      throw notFound(`unknown scope: ${invalid}`);
    }
    // Hex prefix: never contains the '_' separator, so `hl_live_{prefix}_{secret}`
    // stays unambiguously parseable (base64url would not).
    const prefix = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const fullKey = `hl_live_${prefix}_${secret}`;
    const keyHash = createHash('sha256').update(fullKey).digest('hex');

    const key = await this.repository.insert({
      organizationId: scope.organizationId,
      name: input.name,
      prefix,
      keyHash,
      scopes: input.scopes,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt ?? null,
    });
    await this.audit.write({
      organizationId: scope.organizationId,
      actorType: 'user',
      actorId: input.createdByUserId,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: key.id,
      metadata: { name: input.name, scopes: input.scopes },
    });
    return { key, secret: fullKey };
  }

  async list(scope: TenantScope): Promise<ApiKeyRow[]> {
    return this.repository.list(scope);
  }

  async revoke(scope: TenantScope, id: string, actorUserId: string): Promise<ApiKeyRow> {
    const key = await this.repository.revoke(scope, id);
    if (!key) throw notFound('api key not found');
    // Immediate effect: drop the cache entry.
    await this.redis.client.del(cacheKey(key.prefix));
    await this.audit.write({
      organizationId: scope.organizationId,
      actorType: 'user',
      actorId: actorUserId,
      action: 'api_key.revoked',
      targetType: 'api_key',
      targetId: key.id,
    });
    return key;
  }

  /**
   * Resolves a full bearer key to its organization and scopes. Redis fast
   * path (60s), Postgres fallback; revoked/expired keys are rejected.
   */
  async verify(fullKey: string): Promise<ResolvedApiKey> {
    // `hl_live_{hex prefix}_{base64url secret}` — the hex prefix never
    // contains '_', so the first separator after the literal is unambiguous
    // even though the secret alphabet may include it.
    const literal = 'hl_live_';
    if (!fullKey.startsWith(literal)) {
      throw unauthorized('invalid api key format');
    }
    const separator = fullKey.indexOf('_', literal.length);
    if (separator <= literal.length) {
      throw unauthorized('invalid api key format');
    }
    const prefix = fullKey.slice(literal.length, separator);
    const keyHash = createHash('sha256').update(fullKey).digest('hex');

    const cached = await this.readCache(prefix).catch(() => null);
    const record: CachedKey | null = cached ?? (await this.loadAndCache(prefix).catch(() => null));

    if (!record) throw unauthorized('invalid api key');
    const hashMatches =
      record.keyHash.length === keyHash.length &&
      timingSafeEqual(Buffer.from(record.keyHash), Buffer.from(keyHash));
    if (!hashMatches) throw unauthorized('invalid api key');
    if (record.revoked) throw unauthorized('api key revoked');
    if (record.expiresAtIso !== null && new Date(record.expiresAtIso) <= new Date()) {
      throw unauthorized('api key expired');
    }
    this.touchLastUsed(prefix).catch((error: unknown) => {
      this.logger.warn(
        `last_used_at update failed: ${error instanceof Error ? error.message : error}`,
      );
    });
    return {
      apiKeyId: record.id,
      organizationId: record.organizationId,
      scopes: record.scopes,
    };
  }

  private async readCache(prefix: string): Promise<CachedKey | null> {
    const raw = await this.redis.client.hgetall(cacheKey(prefix));
    if (!raw || raw.keyHash === undefined) return null;
    return {
      id: raw.id!,
      organizationId: raw.organizationId!,
      keyHash: raw.keyHash,
      scopes: (raw.scopes?.split(',').filter(Boolean) ?? []) as ApiKeyScope[],
      revoked: raw.revoked === 'true',
      expiresAtIso: raw.expiresAtIso ?? null,
    };
  }

  private async loadAndCache(prefix: string): Promise<CachedKey | null> {
    const row = await this.repository.findByPrefix(prefix);
    if (!row) return null;
    const record: CachedKey = {
      id: row.id,
      organizationId: row.organizationId,
      keyHash: row.keyHash,
      scopes: row.scopes,
      revoked: row.revokedAt !== null,
      expiresAtIso: row.expiresAt ? row.expiresAt.toISOString() : null,
    };
    await this.redis.client.hset(cacheKey(prefix), {
      ...record,
      scopes: record.scopes.join(','),
    });
    await this.redis.client.expire(cacheKey(prefix), CACHE_TTL_SECONDS);
    return record;
  }

  /** At most one write per minute per key (DATA.md 5.1). */
  private async touchLastUsed(prefix: string): Promise<void> {
    const now = Date.now();
    const last = this.lastUsedAtFlushed.get(prefix) ?? 0;
    if (now - last < LAST_USED_THROTTLE_MS) return;
    this.lastUsedAtFlushed.set(prefix, now);
    const row = await this.repository.findByPrefix(prefix);
    if (row) {
      await this.repository.touchLastUsed(row.id, new Date());
    }
  }
}
