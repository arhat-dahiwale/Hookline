import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { EndpointsService } from '../../src/modules/endpoints/index.js';
import { EventsRepository } from '../../src/modules/events/index.js';
import {
  CircuitBreakerService,
  MaintenanceService,
} from '../../src/modules/delivery-engine/index.js';
import { DeliveryProcessor } from '../../src/modules/delivery-engine/delivery-processor.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { RedisService } from '../../src/modules/platform/redis/redis.service.js';
import { createTestApplication, type TestApplication } from './test-app.js';
import { TestReceiver } from './support/test-receiver.js';

let test: TestApplication;
let receiver: TestReceiver;

beforeAll(async () => {
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();
});

afterAll(async () => {
  // The shutdown test closes the app itself; tolerate a second close.
  await test.app.close().catch(() => undefined);
  await receiver.stop();
});

async function setup(): Promise<{
  orgId: string;
  breaker: CircuitBreakerService;
  maintenance: MaintenanceService;
  processor: DeliveryProcessor;
}> {
  const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
  await test.app.get(ApiKeysService).create(tenantScope(orgId), {
    name: 'k',
    scopes: ['events:write'],
    createdByUserId: 'u',
  });
  return {
    orgId,
    breaker: test.app.get(CircuitBreakerService),
    maintenance: test.app.get(MaintenanceService),
    processor: test.app.get(DeliveryProcessor),
  };
}

async function createEndpointFor(
  orgId: string,
  path: string,
  overrides: Record<string, unknown> = {},
) {
  const endpoints = test.app.get(EndpointsService);
  const created = await endpoints.create(
    tenantScope(orgId),
    { url: `${receiver.url}${path}`, ...overrides },
    { type: 'system' },
  );
  return created.endpoint;
}

/** One delivery for an EXISTING endpoint (breaker state is per-endpoint). */
async function createDeliveryFor(orgId: string, endpointId: string, maxAttempts: number) {
  const event = await test.app
    .get(EventsRepository)
    .insert({ organizationId: orgId, type: 'resilience.test', payload: { n: 1 } });
  const [delivery] = await test.app.get(DeliveriesRepository).insertMany([
    {
      organizationId: orgId,
      eventId: event.id,
      endpointId,
      maxAttempts,
      status: 'pending',
    },
  ]);
  return delivery!;
}

/** Convenience: fresh endpoint + one delivery. */
async function createDelivery(
  orgId: string,
  path: string,
  overrides: Record<string, unknown> = {},
) {
  const endpoint = await createEndpointFor(orgId, path, overrides);
  const delivery = await createDeliveryFor(orgId, endpoint.id, endpoint.maxAttempts);
  return { endpoint, delivery };
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('condition not met in time');
}

describe('circuit breaker', () => {
  it('opens after 10 consecutive failures and gates attempts without consuming them', async () => {
    const { orgId, breaker, processor } = await setup();
    const endpoint = await createEndpointFor(orgId, '/fail', { maxAttempts: 1 });

    // Drive 10 failing deliveries to the SAME endpoint.
    for (let i = 0; i < 10; i += 1) {
      const each = await createDeliveryFor(orgId, endpoint.id, 1);
      await processor.process(each.id, orgId);
    }
    expect(await breaker.getState(endpoint.id)).toBe('open');

    // A new delivery to the SAME endpoint is gated: attempt NOT consumed.
    const gated = { delivery: await createDeliveryFor(orgId, endpoint.id, 3) };
    const hitsBefore = receiver.received('/fail').length;
    await processor.process(gated.delivery.id, orgId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(gated.delivery.id);
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0 });
    expect(receiver.received('/fail').length).toBe(hitsBefore);
  });

  it('recovers via a half-open probe after the cooldown', async () => {
    const { orgId, breaker, processor } = await setup();
    const endpoint = await createEndpointFor(orgId, '/flaky', { maxAttempts: 1 });

    // Ten consecutive failures open the breaker.
    receiver.failNext(10);
    for (let i = 0; i < 10; i += 1) {
      const each = await createDeliveryFor(orgId, endpoint.id, 1);
      await processor.process(each.id, orgId);
    }
    expect(await breaker.getState(endpoint.id)).toBe('open');

    // Simulate the cooldown having elapsed; /flaky now succeeds.
    const redis = test.app.get(RedisService);
    await redis.client.hset(`hl:cb:${endpoint.id}`, {
      cooldownMs: '250',
      openedAt: String(Date.now() - 1_000),
    });
    receiver.failNext(0);

    const probe = await createDeliveryFor(orgId, endpoint.id, 2);
    await processor.process(probe.id, orgId);
    expect(await breaker.getState(endpoint.id)).toBe('closed');

    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(probe.id);
    expect(row?.status).toBe('succeeded');

    // Snapshots exist in endpoint_health (Postgres).
    const health = await test.app
      .get(
        (await import('../../src/modules/endpoints/endpoints.repository.js')).EndpointsRepository,
      )
      .findHealth(endpoint.id);
    expect(health?.state).toBe('closed');
  });

  it('re-opens with a doubled cooldown when the probe fails', async () => {
    const { orgId, breaker, processor } = await setup();
    const endpoint = await createEndpointFor(orgId, '/flaky', { maxAttempts: 1 });

    receiver.failNext(10);
    for (let i = 0; i < 10; i += 1) {
      const delivery = await createDeliveryFor(orgId, endpoint.id, 1);
      await processor.process(delivery.id, orgId);
    }
    expect(await breaker.getState(endpoint.id)).toBe('open');

    const redis = test.app.get(RedisService);
    await redis.client.hset(`hl:cb:${endpoint.id}`, {
      cooldownMs: '250',
      openedAt: String(Date.now() - 1_000),
    });

    // The half-open probe fails again: reopen with doubled cooldown.
    receiver.failNext(1);
    const probe = await createDeliveryFor(orgId, endpoint.id, 2);
    await processor.process(probe.id, orgId);
    expect(await breaker.getState(endpoint.id)).toBe('open');
    const record = await redis.client.hgetall(`hl:cb:${endpoint.id}`);
    expect(Number(record.cooldownMs)).toBe(500); // doubled
  });

  it('auto-disables endpoints open for 24h and writes an audit entry', async () => {
    const { orgId, maintenance } = await setup();
    const { endpoint } = await createDelivery(orgId, '/fail');

    const redis = test.app.get(RedisService);
    const dayAgo = Date.now() - 25 * 60 * 60 * 1000;
    await redis.client.hset(`hl:cb:${endpoint.id}`, {
      state: 'open',
      consecutiveFailures: '10',
      openedAt: String(dayAgo),
      firstOpenedAt: String(dayAgo),
      cooldownMs: String(15 * 60_000),
    });

    const disabled = await maintenance.runBreakerSweep();
    expect(disabled).toContain(endpoint.id);

    const { AuditService } = await import('../../src/modules/audit/index.js');
    const [entry] = await test.app
      .get(AuditService)
      .findByAction(tenantScope(orgId), 'endpoint.disabled', 5);
    expect(entry?.metadata).toMatchObject({ reason: 'circuit_breaker' });

    // Idempotent sweep: already disabled, not re-reported.
    const again = await maintenance.runBreakerSweep();
    expect(again).not.toContain(endpoint.id);
  });
});

describe('reconciler', () => {
  it('re-enqueues pending deliveries without live jobs (persisted but never enqueued)', async () => {
    const { orgId, maintenance } = await setup();
    const { delivery } = await createDelivery(orgId, '/ok');

    // Backdate creation beyond the pending grace period.
    await test.app
      .get(DeliveriesRepository)
      .updateById(delivery.id, { createdAt: new Date(Date.now() - 120_000) });

    const healed = await maintenance.runReconciler();
    expect(healed).toBeGreaterThanOrEqual(1);

    await waitFor(
      async () =>
        (await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id))?.status ===
        'succeeded',
    );
  });

  it('re-enqueues overdue retrying deliveries whose job was lost', async () => {
    const { orgId, maintenance } = await setup();
    const { delivery } = await createDelivery(orgId, '/ok');

    // Simulate a lost retry job: status retrying, next attempt overdue.
    await test.app.get(DeliveriesRepository).updateById(delivery.id, {
      status: 'retrying',
      attemptCount: 1,
      nextAttemptAt: new Date(Date.now() - 60_000),
    });

    const healed = await maintenance.runReconciler();
    expect(healed).toBeGreaterThanOrEqual(1);

    await waitFor(
      async () =>
        (await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id))?.status ===
        'succeeded',
    );
    const attempts = await test.app.get(DeliveriesRepository).findAttempts(delivery.id);
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('graceful shutdown', () => {
  it('drains in-flight deliveries before exiting', async () => {
    const { orgId } = await setup();
    const { delivery } = await createDelivery(orgId, '/slow?ms=2500', {
      timeoutMs: 8_000,
      maxAttempts: 2,
    });

    // Deliver via the running worker, then close the app mid-flight: the
    // worker close must wait for the in-flight attempt to finish.
    const { DeliveryQueue } = await import('../../src/modules/delivery-queue/index.js');
    await test.app.get(DeliveryQueue).enqueueAttempt({
      id: delivery.id,
      organizationId: orgId,
      attemptCount: 0,
      status: 'pending',
    });

    await new Promise((resolve) => setTimeout(resolve, 800)); // attempt is now in flight
    await test.app.close(); // graceful: shutdown hooks drain the worker
    const row = await rawDelivery(delivery.id);
    expect(row?.status).toBe('succeeded');
  });
});

/** Post-close DB access through a throwaway pool. */
async function rawDelivery(id: string) {
  const { Pool } = await import('pg');
  const { loadTestEnv } = await import('./test-env.js');
  const pool = new Pool({ connectionString: loadTestEnv().DATABASE_URL, max: 1 });
  const { rows } = await pool.query('select * from deliveries where id = $1', [id]);
  await pool.end();
  return rows[0] as { status: string } | undefined;
}
