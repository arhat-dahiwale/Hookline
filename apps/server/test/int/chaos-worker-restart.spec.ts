import { spawn, type ChildProcess } from 'node:child_process';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { EndpointsService } from '../../src/modules/endpoints/index.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { createTestApplication, type TestApplication } from './test-app.js';
import { loadTestEnv } from './test-env.js';
import { TestReceiver } from './support/test-receiver.js';

/**
 * DONE-criterion chaos test: a SIGKILLed worker loses no deliveries. A real
 * worker child process (`node dist/main.js`, ROLE=worker) consumes the same
 * Testcontainers Postgres/Redis as the test app. The receiver is slow so
 * attempts straddle the kill; the restarted worker (plus BullMQ stalled-job
 * handling) must deliver every accepted event exactly-once-effectively
 * (at-least-once with deduped attempts).
 */

const EVENT_COUNT = 6;
const SLOW_MS = 1500;

let test: TestApplication;
let receiver: TestReceiver;
let orgId = '';
let apiKey = '';
let endpointId = '';
let deliveryIds: string[] = [];

function spawnWorker(): ChildProcess {
  const env = loadTestEnv();
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ROLE: 'worker',
      NODE_ENV: env.NODE_ENV,
      LOG_LEVEL: 'silent',
      PORT: '4998',
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
      INTERNAL_GRPC_TOKEN: env.INTERNAL_GRPC_TOKEN,
      ALLOW_INSECURE_ENDPOINTS: 'true',
      DELIVERY_CONCURRENCY: '2',
      SHUTDOWN_TIMEOUT_MS: '10000',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return child;
}

beforeAll(async () => {
  test = await createTestApplication([], { ALLOW_INSECURE_ENDPOINTS: 'true' });
  receiver = new TestReceiver();
  await receiver.start();

  orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
  apiKey = (
    await test.app.get(ApiKeysService).create(tenantScope(orgId), {
      name: 'chaos',
      scopes: ['events:write'],
      createdByUserId: 'u',
    })
  ).secret;
  const endpoint = await test.app
    .get(EndpointsService)
    .create(
      tenantScope(orgId),
      { url: `${receiver.url}/slow?ms=${SLOW_MS}`, maxAttempts: 5, timeoutMs: 10_000 },
      { type: 'system' },
    );
  endpointId = endpoint.endpoint.id;
});

afterAll(async () => {
  await test.app.close().catch(() => undefined);
  await receiver.stop();
});

it('a killed and restarted worker loses no deliveries', async () => {
  // Ingest the events (delivery rows + queued jobs in the shared Redis).
  for (let i = 0; i < EVENT_COUNT; i += 1) {
    const res = await test.instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: JSON.stringify({ type: 'chaos.event', payload: { i } }),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(202);
    deliveryIds = [...deliveryIds, ...res.json().deliveries.map((d: { id: string }) => d.id)];
  }
  expect(deliveryIds).toHaveLength(EVENT_COUNT);

  // First worker: start and let it pick up jobs, then SIGKILL mid-attempt.
  const first = spawnWorker();
  await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 300));
  first.kill('SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Second worker completes everything (stalled jobs re-run safely).
  const second = spawnWorker();

  const repo = test.app.get(DeliveriesRepository);
  const deadline = Date.now() + 120_000;
  let done = false;
  while (Date.now() < deadline) {
    const rows = await Promise.all(deliveryIds.map((id) => repo.findByIdUnscoped(id)));
    if (rows.every((row) => row?.status === 'succeeded')) {
      done = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  second.kill();
  expect(done).toBe(true);

  // Every accepted event was delivered; attempts may repeat after the kill
  // (at-least-once) but exactly one attempt row exists per attempt number.
  const received = receiver.received('/slow');
  expect(received.length).toBeGreaterThanOrEqual(EVENT_COUNT);
  for (const id of deliveryIds) {
    const attempts = await repo.findAttempts(id);
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    const numbers = attempts.map((a) => a.attemptNumber);
    expect(new Set(numbers).size).toBe(numbers.length); // no duplicate attempt rows
  }
  void endpointId;
}, 180_000);
