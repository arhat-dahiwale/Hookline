import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { EndpointsService } from '../../src/modules/endpoints/index.js';
import { EventsRepository } from '../../src/modules/events/index.js';
import { DeliveryProcessor } from '../../src/modules/delivery-engine/index.js';
import { DeliveryQueue } from '../../src/modules/delivery-queue/index.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { createTestApplication, type TestApplication } from './test-app.js';
import { TestReceiver, type ReceivedRequest } from './support/test-receiver.js';

let test: TestApplication;
let receiver: TestReceiver;

beforeAll(async () => {
  // The receiver is a localhost HTTP server: needs the dev-only escape
  // hatch for connect-time SSRF checks.
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();
});

afterAll(async () => {
  await test.app.close();
  await receiver.stop();
});

/** Fresh org per test so fan-out is fully isolated. */
async function newOrg(): Promise<{ orgId: string; apiKey: string }> {
  const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
  const apiKey = (
    await test.app.get(ApiKeysService).create(tenantScope(orgId), {
      name: 'engine',
      scopes: ['events:write', 'events:read', 'deliveries:read'],
      createdByUserId: 'u',
    })
  ).secret;
  return { orgId, apiKey };
}

async function createEndpoint(
  orgId: string,
  path: string,
  overrides: Record<string, unknown> = {},
) {
  return test.app
    .get(EndpointsService)
    .create(
      tenantScope(orgId),
      { url: `${receiver.url}${path}`, ...overrides },
      { type: 'system' },
    );
}

async function sendEvent(apiKey: string, type: string, payload: Record<string, unknown>) {
  const res = await test.instance.inject({
    method: 'POST',
    url: '/v1/events',
    payload: JSON.stringify({ type, payload }),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
  });
  expect(res.statusCode).toBe(202);
  return res.json() as { id: string; deliveries: { id: string; endpointId: string }[] };
}

async function waitForDelivery(
  deliveryId: string,
  status: 'succeeded' | 'dead' | 'retrying',
  timeoutMs = 30_000,
): Promise<void> {
  const repo = test.app.get(DeliveriesRepository);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await repo.findByIdUnscoped(deliveryId);
    if (row?.status === status) return;
    if (
      row &&
      status !== 'retrying' &&
      (row.status === 'dead' || row.status === 'succeeded' || row.status === 'cancelled')
    ) {
      throw new Error(`delivery ${deliveryId} reached ${row.status} while waiting for ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const finalRow = await repo.findByIdUnscoped(deliveryId);
  const counts = await test.app
    .get(DeliveryQueue)
    .queue.getJobCounts('wait', 'delayed', 'active', 'failed', 'completed');
  throw new Error(
    `timeout waiting for delivery ${deliveryId} -> ${status}; final=${finalRow?.status} attempts=${finalRow?.attemptCount} queue=${JSON.stringify(counts)} hits=${receiver.received().length}`,
  );
}

function verifySignature(
  rawBody: string,
  header: string,
  timestamp: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return header.split(' ').some((part) => part === `v1=${expected}`);
}

describe('delivery engine', () => {
  it('delivers a signed webhook end to end and emits bus events', async () => {
    const { orgId, apiKey } = await newOrg();
    const busEvents: unknown[] = [];
    const emitter = test.app.get(EventEmitter2);
    emitter.on('delivery.attempt.completed', (event: unknown) => busEvents.push(event));

    const endpoint = await createEndpoint(orgId, '/ok');
    const result = await sendEvent(apiKey, 'order.created', { orderId: 'o_1' });
    expect(result.deliveries).toHaveLength(1);
    const deliveryId = result.deliveries[0]!.id;

    await waitForDelivery(deliveryId, 'succeeded');

    const received = receiver.received('/ok').slice(-1) as ReceivedRequest[];
    const request = received[0]!;
    expect(request.headers['hookline-delivery-id']).toBe(deliveryId);
    expect(request.headers['hookline-attempt']).toBe('1');
    expect(request.headers['hookline-event-type']).toBe('order.created');
    const envelope = JSON.parse(request.body);
    expect(envelope).toMatchObject({
      id: result.id,
      type: 'order.created',
      data: { orderId: 'o_1' },
    });
    expect(
      verifySignature(
        request.body,
        request.headers['hookline-signature'] as string,
        request.headers['hookline-timestamp'] as string,
        endpoint.secret,
      ),
    ).toBe(true);

    const attempts = await test.app.get(DeliveriesRepository).findAttempts(deliveryId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      outcome: 'success',
      responseStatus: 200,
      attemptNumber: 1,
    });

    expect(busEvents.length).toBeGreaterThanOrEqual(1);
    emitter.removeAllListeners('delivery.attempt.completed');
  });

  it('retries failures on the documented schedule (~5s to attempt 2)', async () => {
    const { orgId, apiKey } = await newOrg();
    await createEndpoint(orgId, '/flaky', { maxAttempts: 3 });
    receiver.failNext(1);
    receiver.clear();

    const result = await sendEvent(apiKey, 'retry.me', { n: 1 });
    const deliveryId = result.deliveries[0]!.id;

    await waitForDelivery(deliveryId, 'succeeded');

    const hits = receiver.received('/flaky');
    expect(hits.length).toBe(2);
    const delta = hits[1]!.receivedAt - hits[0]!.receivedAt;
    // Attempt 2 fires after 5s ± 20% jitter (4s..6s) plus scheduling slack.
    expect(delta).toBeGreaterThanOrEqual(3_800);
    expect(delta).toBeLessThanOrEqual(9_000);

    const repo = test.app.get(DeliveriesRepository);
    const row = await repo.findByIdUnscoped(deliveryId);
    expect(row?.attemptCount).toBe(2);
    const attempts = await repo.findAttempts(deliveryId);
    expect(attempts.map((a) => a.outcome)).toEqual(['http_error', 'success']);
    expect(attempts[0]?.responseStatus).toBe(503);
  });

  it('moves to dead after exhausting attempts', async () => {
    const { orgId, apiKey } = await newOrg();
    await createEndpoint(orgId, '/fail', { maxAttempts: 2 });
    const result = await sendEvent(apiKey, 'dead.end', { n: 1 });
    const deliveryId = result.deliveries[0]!.id;

    await waitForDelivery(deliveryId, 'dead');

    const repo = test.app.get(DeliveriesRepository);
    const row = await repo.findByIdUnscoped(deliveryId);
    expect(row).toMatchObject({ status: 'dead', attemptCount: 2 });
    expect(row?.completedAt).not.toBeNull();
    const attempts = await repo.findAttempts(deliveryId);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => a.outcome === 'http_error')).toBe(true);
  });

  it('does not follow redirects (302 counts as failure)', async () => {
    const { orgId, apiKey } = await newOrg();
    const okBefore = receiver.received('/ok').length;
    await createEndpoint(orgId, '/redirect');
    const result = await sendEvent(apiKey, 'redirect.test', { n: 1 });
    const deliveryId = result.deliveries[0]!.id;

    await waitForDelivery(deliveryId, 'retrying');

    const attempts = await test.app.get(DeliveriesRepository).findAttempts(deliveryId);
    expect(attempts[0]?.outcome).toBe('http_error');
    expect(attempts[0]?.responseStatus).toBe(302);
    expect(receiver.received('/redirect').length).toBeGreaterThanOrEqual(1);
    expect(receiver.received('/ok').length).toBe(okBefore);
  });

  it('times out slow endpoints and records a timeout outcome', async () => {
    const { orgId, apiKey } = await newOrg();
    await createEndpoint(orgId, '/slow?ms=8000', { timeoutMs: 1_500 });
    const result = await sendEvent(apiKey, 'slow.poke', { n: 1 });
    const deliveryId = result.deliveries[0]!.id;

    await waitForDelivery(deliveryId, 'retrying');

    const attempts = await test.app.get(DeliveriesRepository).findAttempts(deliveryId);
    expect(attempts[0]?.outcome).toBe('timeout');
    expect(attempts[0]?.durationMs).toBeGreaterThanOrEqual(1_400);
    expect(attempts[0]?.durationMs).toBeLessThan(5_000);
  });

  it('dual-signs during a rotation grace window', async () => {
    const { orgId, apiKey } = await newOrg();
    const created = await createEndpoint(orgId, '/ok');
    const rotated = await test.app
      .get(EndpointsService)
      .rotateSecret(tenantScope(orgId), created.endpoint.id, 24, { type: 'system' });
    const countBefore = receiver.received('/ok').length;

    const result = await sendEvent(apiKey, 'rotated.event', { n: 1 });
    await waitForDelivery(result.deliveries[0]!.id, 'succeeded');

    const hits = receiver.received('/ok').slice(countBefore);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const signature = hits[0]!.headers['hookline-signature'] as string;
    expect(signature.split(' ')).toHaveLength(2);
    const timestamp = hits[0]!.headers['hookline-timestamp'] as string;
    expect(verifySignature(hits[0]!.body, signature, timestamp, rotated.secret)).toBe(true);
    expect(verifySignature(hits[0]!.body, signature, timestamp, created.secret)).toBe(true);
  });

  it('duplicate job execution is a no-op (attempt claimed exactly once)', async () => {
    const { orgId } = await newOrg();
    const endpoint = await createEndpoint(orgId, '/ok');
    const before = receiver.received('/ok').length;

    // Create the event + delivery WITHOUT the queue (direct repositories) so
    // only the two concurrent manual runs below compete for the attempt.
    const event = await test.app
      .get(EventsRepository)
      .insert({ organizationId: orgId, type: 'dup.test', payload: { n: 1 } });
    const [delivery] = await test.app.get(DeliveriesRepository).insertMany([
      {
        organizationId: orgId,
        eventId: event.id,
        endpointId: endpoint.endpoint.id,
        maxAttempts: endpoint.endpoint.maxAttempts,
        status: 'pending',
      },
    ]);

    // Run the processor twice CONCURRENTLY for the same delivery: the claim
    // is atomic, so exactly one attempt runs and one HTTP request is made.
    const processor = test.app.get(DeliveryProcessor);
    await Promise.allSettled([
      processor.process(delivery!.id, orgId),
      processor.process(delivery!.id, orgId),
    ]);
    await waitForDelivery(delivery!.id, 'succeeded');

    const newHits = receiver.received('/ok').slice(before);
    expect(newHits.length).toBe(1);
    const attempts = await test.app.get(DeliveriesRepository).findAttempts(delivery!.id);
    expect(attempts).toHaveLength(1);
  });
});
