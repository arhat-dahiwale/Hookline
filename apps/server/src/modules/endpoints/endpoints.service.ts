import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { TenantScope } from '../platform/database/tenant-scope.js';
import { SecretCipher } from '../platform/crypto/secret-cipher.js';
import { conflict, notFound } from '../platform/errors/app-error.js';
import { AuditService } from '../audit/index.js';
import { EndpointsRepository, type EndpointRow } from './endpoints.repository.js';

const DEFAULT_GRACE_HOURS = 24;

export interface CreateEndpointInput {
  url: string;
  description?: string | null;
  eventTypes?: string[];
  timeoutMs?: number;
  maxAttempts?: number;
  rateLimitPerSecond?: number;
  metadata?: Record<string, unknown>;
}

export interface CreatedEndpoint {
  endpoint: EndpointRow;
  /** Signing secret, returned exactly once (whsec_...). */
  secret: string;
}

/**
 * Endpoint lifecycle. URL validation (SSRF/HTTPS rules) is enforced by the
 * protocol layer via the shared validator (Phase 4); this service owns
 * secrets (AES-256-GCM at rest) and state transitions.
 */
@Injectable()
export class EndpointsService {
  constructor(
    private readonly repository: EndpointsRepository,
    private readonly cipher: SecretCipher,
    private readonly audit: AuditService,
    private readonly emitter: EventEmitter2,
  ) {}

  async create(
    scope: TenantScope,
    input: CreateEndpointInput,
    actor: { type: 'user' | 'api_key' | 'system'; id?: string },
  ): Promise<CreatedEndpoint> {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const endpoint = await this.repository.insert({
      organizationId: scope.organizationId,
      url: input.url,
      description: input.description ?? null,
      secretEncrypted: this.cipher.encrypt(secret),
      eventTypes: input.eventTypes ?? [],
      timeoutMs: input.timeoutMs ?? 10_000,
      maxAttempts: input.maxAttempts ?? 8,
      rateLimitPerSecond: input.rateLimitPerSecond ?? 10,
      metadata: input.metadata ?? {},
    });
    await this.repository.ensureHealthRow(endpoint.id);
    await this.audit.write({
      organizationId: scope.organizationId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'endpoint.created',
      targetType: 'endpoint',
      targetId: endpoint.id,
      metadata: { url: input.url },
    });
    return { endpoint, secret };
  }

  async get(scope: TenantScope, id: string): Promise<EndpointRow> {
    const endpoint = await this.repository.findById(scope, id);
    if (!endpoint) throw notFound('endpoint not found');
    return endpoint;
  }

  async list(scope: TenantScope): Promise<EndpointRow[]> {
    return this.repository.listAll(scope);
  }

  async update(
    scope: TenantScope,
    id: string,
    patch: {
      url?: string;
      description?: string | null;
      eventTypes?: string[];
      timeoutMs?: number;
      maxAttempts?: number;
      rateLimitPerSecond?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<EndpointRow> {
    const updated = await this.repository.update(scope, id, patch);
    if (!updated) throw notFound('endpoint not found');
    return updated;
  }

  async rotateSecret(
    scope: TenantScope,
    id: string,
    gracePeriodHours: number,
    actor: { type: 'user' | 'api_key' | 'system'; id?: string },
  ): Promise<{ endpoint: EndpointRow; secret: string }> {
    if (gracePeriodHours < 0 || gracePeriodHours > 168) {
      throw conflict('gracePeriodHours must be between 0 and 168');
    }
    const endpoint = await this.repository.findById(scope, id);
    if (!endpoint) throw notFound('endpoint not found');

    const newSecret = `whsec_${randomBytes(24).toString('base64url')}`;
    const updated = await this.repository.update(scope, id, {
      previousSecretEncrypted:
        gracePeriodHours > 0 ? endpoint.secretEncrypted : endpoint.previousSecretEncrypted,
      previousSecretExpiresAt:
        gracePeriodHours > 0
          ? new Date(Date.now() + gracePeriodHours * 3_600_000)
          : endpoint.previousSecretExpiresAt,
      secretEncrypted: this.cipher.encrypt(newSecret),
    });
    await this.audit.write({
      organizationId: scope.organizationId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'endpoint.secret_rotated',
      targetType: 'endpoint',
      targetId: id,
      metadata: { gracePeriodHours },
    });
    return { endpoint: updated ?? endpoint, secret: newSecret };
  }

  async decryptCurrentSecret(endpoint: EndpointRow): Promise<string> {
    return this.cipher.decrypt(endpoint.secretEncrypted);
  }

  /** Both secrets during a rotation window, oldest first (dual signing). */
  async decryptActiveSecrets(endpoint: EndpointRow): Promise<string[]> {
    const secrets = [await this.decryptCurrentSecret(endpoint)];
    const previousBlob = endpoint.previousSecretEncrypted;
    const expiresAt = endpoint.previousSecretExpiresAt;
    if (previousBlob && expiresAt && expiresAt.getTime() > Date.now()) {
      secrets.push(this.cipher.decrypt(previousBlob));
    }
    return secrets;
  }

  async setStatus(
    scope: TenantScope,
    id: string,
    status: 'active' | 'disabled',
    reason: 'manual' | 'circuit_breaker',
    actor: { type: 'user' | 'api_key' | 'system'; id?: string },
  ): Promise<EndpointRow> {
    const endpoint = await this.repository.findById(scope, id);
    if (!endpoint) throw notFound('endpoint not found');
    if (endpoint.status === status) {
      throw conflict(`endpoint already ${status}`);
    }
    const updated = await this.repository.update(scope, id, {
      status,
      disabledReason: status === 'disabled' ? reason : null,
      disabledAt: status === 'disabled' ? new Date() : null,
    });
    if (status === 'active') {
      // The delivery engine resets the circuit breaker on enable (API.md).
      await this.emitter.emitAsync('endpoint.enabled', { endpointId: id });
    }
    await this.audit.write({
      organizationId: scope.organizationId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: status === 'disabled' ? 'endpoint.disabled' : 'endpoint.enabled',
      targetType: 'endpoint',
      targetId: id,
      metadata: { reason },
    });
    return updated ?? endpoint;
  }

  async softDelete(
    scope: TenantScope,
    id: string,
    actor: { type: 'user' | 'api_key'; id: string },
  ): Promise<void> {
    const deleted = await this.repository.softDelete(scope, id);
    if (!deleted) throw notFound('endpoint not found');
    await this.audit.write({
      organizationId: scope.organizationId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'endpoint.deleted',
      targetType: 'endpoint',
      targetId: id,
    });
  }

  /** Default grace window constant for API docs. */
  get defaultGraceHours(): number {
    return DEFAULT_GRACE_HOURS;
  }
}
