import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { RedisService } from '../platform/redis/redis.service.js';
import { MetricsService } from '../observability/index.js';
import { EndpointsRepository } from '../endpoints/index.js';

const WINDOW_SIZE = 20;
const CONSECUTIVE_FAILURES_TO_OPEN = 10;
const FAILURE_RATE_THRESHOLD = 0.5;
const BASE_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 15 * 60_000;
const OPEN_24H_MS = 24 * 60 * 60 * 1000;

export type BreakerState = 'closed' | 'open' | 'half_open';

interface BreakerRecord {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  firstOpenedAt: number | null;
  cooldownMs: number;
}

function breakerKey(endpointId: string): string {
  return `hl:cb:${endpointId}`;
}

function windowKey(endpointId: string): string {
  return `hl:cb:window:${endpointId}`;
}

function probeLeaseKey(endpointId: string): string {
  return `hl:cb:${endpointId}:probe-lease`;
}

/**
 * Per-endpoint circuit breaker (ARCHITECTURE.md 6.3). Live state in Redis
 * (`hl:cb:{endpointId}`), snapshots written to `endpoint_health` via the
 * endpoints repository. Open → half-open after a doubling cooldown; one
 * probe attempt in half-open; success closes, failure reopens.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly endpointsRepository: EndpointsRepository,
    private readonly emitter: EventEmitter2,
    private readonly metrics: MetricsService,
  ) {}

  private async read(endpointId: string): Promise<BreakerRecord> {
    const raw = await this.redis.client.hgetall(breakerKey(endpointId));
    if (!raw || raw.state === undefined) {
      return {
        state: 'closed',
        consecutiveFailures: 0,
        openedAt: null,
        firstOpenedAt: null,
        cooldownMs: BASE_COOLDOWN_MS,
      };
    }
    return {
      state: raw.state as BreakerState,
      consecutiveFailures: Number(raw.consecutiveFailures ?? 0),
      openedAt: raw.openedAt !== undefined && raw.openedAt !== '' ? Number(raw.openedAt) : null,
      firstOpenedAt:
        raw.firstOpenedAt !== undefined && raw.firstOpenedAt !== ''
          ? Number(raw.firstOpenedAt)
          : null,
      cooldownMs: Number(raw.cooldownMs ?? BASE_COOLDOWN_MS),
    };
  }

  private async write(endpointId: string, record: BreakerRecord): Promise<void> {
    await this.redis.client.hset(breakerKey(endpointId), {
      state: record.state,
      consecutiveFailures: String(record.consecutiveFailures),
      openedAt: record.openedAt === null ? '' : String(record.openedAt),
      firstOpenedAt: record.firstOpenedAt === null ? '' : String(record.firstOpenedAt),
      cooldownMs: String(record.cooldownMs),
    });
  }

  /**
   * Gate for an attempt. Returns allowed=false with a retryAfterMs when the
   * breaker is open (and not yet cooled down). The first request after the
   * cooldown flips the breaker to half-open and becomes the probe.
   */
  async beforeAttempt(endpointId: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const record = await this.read(endpointId);
    if (record.state === 'closed') return { allowed: true, retryAfterMs: 0 };

    if (record.state === 'open') {
      const elapsed = Date.now() - (record.openedAt ?? 0);
      if (elapsed < record.cooldownMs) {
        return { allowed: false, retryAfterMs: record.cooldownMs - elapsed };
      }
      // Cooldown over: transition to half-open, let the caller probe.
      await this.write(endpointId, { ...record, state: 'half_open' });
      await this.snapshot(endpointId, 'half_open', record);
      // fall through to lease acquisition
    }

    // half_open: exactly one probe at a time (lease expires with the probe).
    const lease = await this.redis.client.set(
      probeLeaseKey(endpointId),
      String(Date.now()),
      'PX',
      30_000,
      'NX',
    );
    if (lease !== 'OK') {
      return { allowed: false, retryAfterMs: 1_000 };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  async recordSuccess(endpointId: string): Promise<void> {
    const record = await this.read(endpointId);
    await this.write(endpointId, {
      ...record,
      state: 'closed',
      consecutiveFailures: 0,
      openedAt: null,
      firstOpenedAt: null,
      cooldownMs: BASE_COOLDOWN_MS,
    });
    await this.redis.client.lpush(windowKey(endpointId), 's');
    await this.redis.client.ltrim(windowKey(endpointId), 0, WINDOW_SIZE - 1);
    await this.redis.client.expire(windowKey(endpointId), 3_600);
    await this.snapshot(endpointId, 'closed', { consecutiveFailures: 0 });
  }

  async recordFailure(endpointId: string): Promise<void> {
    const record = await this.read(endpointId);
    const consecutiveFailures = record.consecutiveFailures + 1;
    await this.redis.client.lpush(windowKey(endpointId), 'f');
    await this.redis.client.ltrim(windowKey(endpointId), 0, WINDOW_SIZE - 1);
    await this.redis.client.expire(windowKey(endpointId), 3_600);

    const window = await this.redis.client.lrange(windowKey(endpointId), 0, WINDOW_SIZE - 1);
    const failures = window.filter((entry) => entry === 'f').length;
    const rateTrigger =
      window.length >= WINDOW_SIZE && failures / window.length > FAILURE_RATE_THRESHOLD;
    const consecutiveTrigger = consecutiveFailures >= CONSECUTIVE_FAILURES_TO_OPEN;

    const wasOpen = record.state !== 'closed';
    if (!wasOpen && (consecutiveTrigger || rateTrigger)) {
      const now = Date.now();
      await this.write(endpointId, {
        state: 'open',
        consecutiveFailures,
        openedAt: now,
        firstOpenedAt: now,
        cooldownMs: BASE_COOLDOWN_MS,
      });
      await this.snapshot(endpointId, 'open', { consecutiveFailures, openedAt: now });
      this.logger.warn(`circuit OPEN for endpoint ${endpointId}`);
      return;
    }

    if (record.state === 'half_open') {
      // Failed probe: reopen with a doubled cooldown (cap 15 min).
      const now = Date.now();
      const cooldownMs = Math.min(record.cooldownMs * 2, MAX_COOLDOWN_MS);
      await this.write(endpointId, {
        state: 'open',
        consecutiveFailures,
        openedAt: now,
        firstOpenedAt: record.firstOpenedAt ?? now,
        cooldownMs,
      });
      await this.snapshot(endpointId, 'open', { consecutiveFailures, openedAt: now });
      this.logger.warn(`circuit RE-OPENED for endpoint ${endpointId} (cooldown ${cooldownMs}ms)`);
      return;
    }

    await this.write(endpointId, { ...record, consecutiveFailures });
  }

  /** Auto-disable sweep: endpoints open continuously for 24h (FR/ARCH 6.3). */
  async findSustainedOpen(olderThanMs: number, limit = 50): Promise<string[]> {
    const keys = await this.redis.client.keys('hl:cb:*');
    const breakerKeys = keys.filter(
      (key) =>
        key.startsWith('hl:cb:') && !key.includes(':window:') && !key.includes(':probe-lease'),
    );
    const sustained: string[] = [];
    for (const key of breakerKeys.slice(0, limit * 3)) {
      const raw = await this.redis.client.hgetall(key);
      if (raw.state !== 'open' || !raw.firstOpenedAt) continue;
      if (Date.now() - Number(raw.firstOpenedAt) >= olderThanMs) {
        sustained.push(key.slice('hl:cb:'.length));
        if (sustained.length >= limit) break;
      }
    }
    return sustained;
  }

  /** Manual enable resets the breaker (API.md endpoints/enable). */
  @OnEvent('endpoint.enabled')
  async onEndpointEnabled(event: { endpointId: string }): Promise<void> {
    await this.reset(event.endpointId);
  }

  async reset(endpointId: string): Promise<void> {
    await this.redis.client.del(
      breakerKey(endpointId),
      windowKey(endpointId),
      probeLeaseKey(endpointId),
    );
    await this.snapshot(endpointId, 'closed', { consecutiveFailures: 0 });
  }

  async getState(endpointId: string): Promise<BreakerState> {
    return (await this.read(endpointId)).state;
  }

  private async snapshot(
    endpointId: string,
    state: BreakerState,
    extra: { consecutiveFailures?: number; openedAt?: number | null },
  ): Promise<void> {
    try {
      await this.endpointsRepository.upsertHealth(endpointId, {
        state,
        consecutiveFailures: extra.consecutiveFailures ?? 0,
        openedAt: extra.openedAt ? new Date(extra.openedAt) : null,
        ...(state === 'closed' ? { lastSuccessAt: new Date() } : {}),
        ...(state === 'open' ? { lastFailureAt: new Date() } : {}),
      });
      // Fire-and-forget: the realtime bridge fans this out to WebSocket
      // subscribers. Never blocks or fails the delivery path.
      this.metrics.breakerTransitions.inc({ to: state });
      const endpoint = await this.endpointsRepository.findByIdUnscoped(endpointId);
      if (endpoint) {
        void this.emitter.emit('endpoint.health.changed', {
          organizationId: endpoint.organizationId,
          endpointId,
          state,
          reason: extra.consecutiveFailures !== undefined ? 'failures' : 'probe',
        });
      }
    } catch (error) {
      this.logger.warn(
        `breaker snapshot failed for ${endpointId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

export const BREAKER_24H_MS = OPEN_24H_MS;
