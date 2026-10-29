import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Job } from 'bullmq';

import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { EndpointsRepository, EndpointsService } from '../../src/modules/endpoints/index.js';
import { EventsRepository } from '../../src/modules/events/index.js';
import { DeliveryProcessor } from '../../src/modules/delivery-engine/index.js';
import { DeliveryQueue, deliveryJobId } from '../../src/modules/delivery-queue/index.js';
import { MetricsService } from '../../src/modules/observability/index.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { RedisService } from '../../src/modules/platform/redis/redis.service.js';
import { TokenBucketRateLimiter } from '../../src/modules/platform/rate-limiter/token-bucket.js';
import { createTestApplication, type TestApplication } from './test-app.js';
import { loadTestEnv } from './test-env.js';
import { TestReceiver } from './support/test-receiver.js';

/**
 * Deterministic branch coverage for the delivery processor (ARCHITECTURE.md
 * 5.2). The other suites reach these paths only through full delivery flows
 * whose coverage shifts with runtime races (the CI coverage threshold failed
 * exactly on that). Here every guard, redelay path and the worker failure
 * handler is driven directly, with pre-arranged state instead of timing.
 */

let test: TestApplication;
let receiver: TestReceiver;

beforeAll(async () => {
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();
});

afterAll(async () => {
  await test.app.close();
  await receiver.stop();
});

function newOrgId(): string {
  return `org_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function createEndpoint(orgId: string, path = '/ok') {
  return test.app
    .get(EndpointsService)
    .create(tenantScope(orgId), { url: `${receiver.url}${path}` }, { type: 'system' });
}

async function createDelivery(orgId: string, endpointId: string, maxAttempts = 3) {
  const event = await test.app
    .get(EventsRepository)
    .insert({ organizationId: orgId, type: 'processor.test', payload: { n: 1 } });
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

async function outboundLimitedCount(metrics: MetricsService): Promise<number> {
  const { values } = await metrics.rateLimited.get();
  const entry = values.find((value) => value.labels.scope === 'outbound');
  return entry?.value ?? 0;
}

describe('delivery processor guards', () => {
  it('skips deliveries that do not exist or belong to another organization', async () => {
    const orgId = newOrgId();
    const endpoint = await createEndpoint(orgId);
    const delivery = await createDelivery(orgId, endpoint.endpoint.id);
    const hitsBefore = receiver.received('/ok').length;
    const processor = test.app.get(DeliveryProcessor);

    await expect(processor.process(`dlv_${'0'.repeat(26)}`, orgId)).resolves.toBeUndefined();
    await expect(processor.process(delivery.id, newOrgId())).resolves.toBeUndefined();

    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id);
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0 });
    expect(receiver.received('/ok').length).toBe(hitsBefore);
  });

  it('skips deliveries that already reached a terminal state', async () => {
    const orgId = newOrgId();
    const endpoint = await createEndpoint(orgId);
    const delivery = await createDelivery(orgId, endpoint.endpoint.id);
    await test.app.get(DeliveriesRepository).updateById(delivery.id, { status: 'succeeded' });
    const hitsBefore = receiver.received('/ok').length;

    await test.app.get(DeliveryProcessor).process(delivery.id, orgId);

    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id);
    expect(row?.attemptCount).toBe(0);
    expect(receiver.received('/ok').length).toBe(hitsBefore);
  });

  it('cancels deliveries whose endpoint was disabled or deleted', async () => {
    const orgId = newOrgId();
    const endpoints = test.app.get(EndpointsRepository);
    const disabled = await createEndpoint(orgId);
    const deleted = await createEndpoint(orgId);
    await endpoints.update(tenantScope(orgId), disabled.endpoint.id, {
      status: 'disabled',
      disabledReason: 'test',
    });
    await endpoints.softDelete(tenantScope(orgId), deleted.endpoint.id);

    const forDisabled = await createDelivery(orgId, disabled.endpoint.id);
    const forDeleted = await createDelivery(orgId, deleted.endpoint.id);

    const processor = test.app.get(DeliveryProcessor);
    await processor.process(forDisabled.id, orgId);
    await processor.process(forDeleted.id, orgId);

    const repo = test.app.get(DeliveriesRepository);
    expect((await repo.findByIdUnscoped(forDisabled.id))?.status).toBe('cancelled');
    expect((await repo.findByIdUnscoped(forDeleted.id))?.status).toBe('cancelled');
    expect(receiver.received('/ok').length).toBe(0);
  });

  it('cancels deliveries whose event row is gone', async () => {
    const orgId = newOrgId();
    const endpoint = await createEndpoint(orgId);
    const delivery = await createDelivery(orgId, endpoint.endpoint.id);

    // deliveries.event_id is ON DELETE CASCADE, so the event row is removed
    // with referential-integrity triggers bypassed (session-scoped, restored
    // immediately; the Testcontainers user is a superuser). That leaves the
    // dangling delivery the guard exists for.
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: loadTestEnv().DATABASE_URL, max: 1 });
    try {
      await pool.query('set session_replication_role = replica');
      await pool.query('delete from events where id = $1', [delivery.eventId]);
    } finally {
      await pool.query('set session_replication_role = origin').catch(() => undefined);
      await pool.end();
    }

    await test.app.get(DeliveryProcessor).process(delivery.id, orgId);

    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id);
    expect(row?.status).toBe('cancelled');
    expect(receiver.received('/ok').length).toBe(0);
  });
});

describe('delivery processor redelay and failure handling', () => {
  it('re-delays rate-limited attempts without consuming an attempt', async () => {
    const orgId = newOrgId();
    const endpoint = await createEndpoint(orgId);
    const delivery = await createDelivery(orgId, endpoint.endpoint.id);

    // Drain the endpoint's token bucket (it initializes full at capacity 2)
    // so the next take is denied deterministically — no reliance on
    // scheduling speed.
    const limiter = test.app.get(TokenBucketRateLimiter);
    const key = `hl:rl:endpoint:${endpoint.endpoint.id}`;
    await limiter.take(key, { ratePerSecond: 1, capacity: 2 });
    await limiter.take(key, { ratePerSecond: 1, capacity: 2 });

    const metrics = test.app.get(MetricsService);
    const limitedBefore = await outboundLimitedCount(metrics);
    const hitsBefore = receiver.received('/ok').length;

    // A live job token: the denied attempt is re-delayed on the job itself.
    // (A real queued job also works, but BullMQ's post-redelay state juggling
    // then races the promoted retry — the benign "Missing lock" stderr seen
    // in CI — so the branch is covered without the queue here.)
    const delayedJob = {
      token: 'delayed-token',
      moveToDelayed: async () => undefined,
    } as unknown as Job;

    await test.app.get(DeliveryProcessor).process(delivery.id, orgId, delayedJob);

    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id);
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0 });
    expect(await outboundLimitedCount(metrics)).toBe(limitedBefore + 1);
    expect(receiver.received('/ok').length).toBe(hitsBefore);
  });

  it('falls back to enqueueing when the job can no longer be moved to delayed', async () => {
    const orgId = newOrgId();
    const endpoint = await createEndpoint(orgId);
    const delivery = await createDelivery(orgId, endpoint.endpoint.id);

    // Open the breaker directly (record shape per DATA.md `hl:cb:*`), with a
    // cooldown long enough that the parked fallback job stays out of the way.
    const redis = test.app.get(RedisService);
    await redis.client.hset(`hl:cb:${endpoint.endpoint.id}`, {
      state: 'open',
      consecutiveFailures: '10',
      openedAt: String(Date.now()),
      firstOpenedAt: String(Date.now()),
      cooldownMs: String(60_000),
    });

    // A stale job whose lock is gone: moveToDelayed rejects, and the
    // processor must still guarantee a live (delayed) job for the attempt.
    const lostLockJob = {
      token: 'lost-lock-token',
      moveToDelayed: async () => {
        throw new Error('job lock no longer held');
      },
    } as unknown as Job;

    await test.app.get(DeliveryProcessor).process(delivery.id, orgId, lostLockJob);

    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id);
    expect(row).toMatchObject({ status: 'pending', attemptCount: 0 });
    const job = await test.app.get(DeliveryQueue).queue.getJob(deliveryJobId(delivery.id, 1));
    expect(job).not.toBeNull();
  });

  it('moves the job to failed when an attempt throws (worker failed handler)', async () => {
    const orgId = newOrgId();
    const endpoint = await createEndpoint(orgId);
    const delivery = await createDelivery(orgId, endpoint.endpoint.id, 2);

    // Corrupt the stored AES-GCM blob: decryption fails mid-attempt after the
    // atomic claim, the job rejects, and BullMQ moves it to failed.
    await test.app.get(EndpointsRepository).update(tenantScope(orgId), endpoint.endpoint.id, {
      secretEncrypted: 'not-a-valid-gcm-blob',
    });

    const queue = test.app.get(DeliveryQueue);
    await queue.enqueueAttempt({
      id: delivery.id,
      organizationId: orgId,
      attemptCount: 0,
      status: 'pending',
    });

    // Poll for the recorded failure; the worker's 'failed' handler runs
    // synchronously when BullMQ emits the event right after the move, so a
    // short settle after the state flip is enough for it to have executed.
    const jobId = deliveryJobId(delivery.id, 1);
    let job = await queue.queue.getJob(jobId);
    const deadline = Date.now() + 20_000;
    while (job !== undefined && job !== null && !(await job.isFailed()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      job = await queue.queue.getJob(jobId);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await job?.isFailed()).toBe(true);
    expect(job?.failedReason).toBeTruthy();

    // The claim happened before the throw: the attempt is consumed and the
    // row left in_progress — the exact orphan the reconciler heals (see
    // resilience.spec).
    const row = await test.app.get(DeliveriesRepository).findByIdUnscoped(delivery.id);
    expect(row).toMatchObject({ status: 'in_progress', attemptCount: 1 });
  }, 30_000);
});
