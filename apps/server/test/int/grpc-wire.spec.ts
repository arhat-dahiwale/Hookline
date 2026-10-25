import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import * as grpc from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { tenantScope } from '../../src/modules/platform/database/tenant-scope.js';
import {
  WORKER_OPERATIONS,
  type WorkerOperationsService,
} from '../../src/modules/worker-ops/index.js';
import { loadWorkerProto } from '../../src/modules/worker-ops/grpc-server.js';
import { CookieJar, createTestApplication, listen, type TestApplication } from './test-app.js';
import { loadTestEnv } from './test-env.js';
import { TestReceiver } from './support/test-receiver.js';

/**
 * Phase 10 wire test (AGENTS.md done criteria): the API role (in-process,
 * gRPC client adapter) against a REAL worker child process
 * (`node dist/main.js`, ROLE=worker) — replay and test-endpoint work over
 * the wire, the token check rejects wrong tokens, and the health service
 * answers SERVING.
 */

let api: TestApplication;
let receiver: TestReceiver;
let worker: ChildProcess | null = null;
let baseUrl = '';
let grpcPort = 50051;

function pickFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 50051;
      probe.close(() => resolve(port));
    });
  });
}

interface Session {
  jar: CookieJar;
  organizationId: string;
}

beforeAll(async () => {
  grpcPort = await pickFreePort();
  api = await createTestApplication(
    [],
    {
      ALLOW_INSECURE_ENDPOINTS: 'true',
      WORKER_GRPC_URL: `localhost:${grpcPort}`,
    },
    'api',
  );
  receiver = new TestReceiver();
  await receiver.start();
  baseUrl = await listen(api);

  const env = loadTestEnv();
  worker = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ROLE: 'worker',
      NODE_ENV: env.NODE_ENV,
      LOG_LEVEL: 'silent',
      PORT: '4997',
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
      INTERNAL_GRPC_TOKEN: env.INTERNAL_GRPC_TOKEN,
      GRPC_PORT: String(grpcPort),
      ALLOW_INSECURE_ENDPOINTS: 'true',
      DELIVERY_CONCURRENCY: '2',
      SHUTDOWN_TIMEOUT_MS: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout?.on('data', (chunk) => process.stdout.write(`[worker] ${chunk}`));
  worker.stderr?.on('data', (chunk) => process.stdout.write(`[worker:err] ${chunk}`));

  // Wait for the child's gRPC server to accept TCP connections.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port: grpcPort });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1000);
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('worker gRPC server never opened its port');
}, 60_000);

afterAll(async () => {
  worker?.kill('SIGTERM');
  await api.app.close();
  await receiver.stop().catch(() => undefined);
});

async function makeSession(): Promise<Session> {
  const jar = new CookieJar();
  const inject = async (method: string, url: string, payload?: unknown) => {
    const response = await api.instance.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
      headers: {
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(jar.header() ? { cookie: jar.header() } : {}),
      },
    });
    jar.capture(response);
    return response;
  };
  await inject('POST', '/api/auth/sign-up/email', {
    email: `wire-${randomUUID()}@example.test`,
    password: 'password-123456',
    name: 'Wire',
  });
  const org = await inject('POST', '/api/auth/organization/create', {
    name: 'wire-org',
    slug: `wire-${randomUUID()}`,
  });
  const organizationId = (org.json() as { id: string }).id;
  await inject('POST', '/api/auth/organization/set-active', { organizationId });
  return { jar, organizationId };
}

function operations(): WorkerOperationsService {
  return api.app.get(WORKER_OPERATIONS) as WorkerOperationsService;
}

async function createEndpointAndKey(
  session: Session,
): Promise<{ endpointId: string; apiKey: string }> {
  const me = (
    await api.instance.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie: session.jar.header() ?? '' },
    })
  ).json() as { user: { id: string } };
  const keys = api.app.get(ApiKeysService);
  const key = await keys.create(tenantScope(session.organizationId), {
    name: 'wire',
    scopes: ['events:write', 'endpoints:write'],
    createdByUserId: me.user.id,
  });
  const created = await fetch(`${baseUrl}/v1/endpoints`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: receiver.url + '/ok' }),
  });
  expect(created.status).toBe(201);
  const endpointId = ((await created.json()) as { id: string }).id;
  return { endpointId, apiKey: key.secret };
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('condition not met in time');
}

describe('worker gRPC over the wire', () => {
  it('exposes the standard health service', async () => {
    // The health service lives in health.proto — a separate load. The proto
    // dir resolves from the workspace layout (cwd is apps/server).
    const { loadSync } = await import('@grpc/proto-loader');
    const protoDir = resolve(process.cwd(), '../../packages/proto/protos');
    const healthDefinition = loadSync(resolve(protoDir, 'health.proto'), {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });
    const HealthClient = (
      grpc.loadPackageDefinition(healthDefinition) as unknown as {
        grpc: {
          health: { v1: { Health: new (a: string, c: grpc.ChannelCredentials) => grpc.Client } };
        };
      }
    ).grpc.health.v1.Health;
    const health = new HealthClient(`localhost:${grpcPort}`, grpc.credentials.createInsecure());
    const status = await new Promise<string>((resolve, reject) => {
      (
        health as never as {
          Check: (
            r: { service: string },
            cb: (error: grpc.ServiceError | null, response: { status: string }) => void,
          ) => void;
        }
      ).Check({ service: '' }, (error, response) =>
        error ? reject(error) : resolve(response.status),
      );
    });
    expect(status).toBe('SERVING');
    health.close();
  });

  it('rejects a wrong internal token with UNAUTHENTICATED', async () => {
    const definition = loadWorkerProto();
    const Client = (
      grpc.loadPackageDefinition(definition) as unknown as {
        hookline: {
          worker: {
            v1: { WorkerService: new (a: string, c: grpc.ChannelCredentials) => grpc.Client };
          };
        };
      }
    ).hookline.worker.v1.WorkerService;
    const client = new Client(`localhost:${grpcPort}`, grpc.credentials.createInsecure());
    const metadata = new grpc.Metadata();
    metadata.set('x-internal-token', 'wrong-token');
    const code = await new Promise<number>((resolve) => {
      (
        client as never as {
          TestEndpoint: (
            r: unknown,
            m: grpc.Metadata,
            cb: (e: grpc.ServiceError | null) => void,
          ) => void;
        }
      ).TestEndpoint({ organizationId: 'org_x', endpointId: 'end_x' }, metadata, (error) =>
        resolve(error ? error.code : 0),
      );
    });
    expect(code).toBe(grpc.status.UNAUTHENTICATED);
    client.close();
  });

  it('runs test-endpoint and replay through the worker process', async () => {
    const session = await makeSession();
    const { endpointId, apiKey } = await createEndpointAndKey(session);
    const ops = operations();

    // Test send over the wire: the child process performs the HTTP request.
    const test = await ops.testEndpoint({ organizationId: session.organizationId, endpointId });
    expect(test.outcome).toBe('success');
    expect(test.responseStatus).toBe(200);

    // Ingest an event; the child worker delivers it.
    const ingest = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'wire.test', payload: {} }),
    });
    expect(ingest.status).toBe(202);
    const eventId = ((await ingest.json()) as { id: string }).id;

    // Replay the EVENT over the wire (creates new deliveries, worker sends).
    const replayed = await ops.replayEvent({
      organizationId: session.organizationId,
      eventId,
    });
    expect(replayed.newDeliveryIds.length).toBeGreaterThanOrEqual(1);

    // The replay delivery reaches succeeded via the child worker.
    const deliveries = api.app.get(DeliveriesRepository);
    await waitFor(async () => {
      const row = await deliveries.findByIdUnscoped(replayed.newDeliveryIds[0]!);
      return row?.status === 'succeeded';
    });

    // Single delivery replay over the wire too.
    const original = await deliveries.listForEvent(tenantScope(session.organizationId), eventId);
    const replayOne = await ops.replayDelivery({
      organizationId: session.organizationId,
      deliveryId: original[0]!.id,
    });
    expect(replayOne.newDeliveryId).not.toBe(original[0]!.id);

    const health = await ops.getEndpointHealth({
      organizationId: session.organizationId,
      endpointId,
    });
    expect(health.state).toBe('closed');
  }, 90_000);

  it('streams attempt events for an endpoint', async () => {
    const session = await makeSession();
    const { endpointId, apiKey } = await createEndpointAndKey(session);
    const ops = operations();

    const controller = new AbortController();
    const received: string[] = [];
    const streamPromise = (async () => {
      for await (const event of ops.streamDeliveryAttempts(
        { organizationId: session.organizationId, endpointId },
        { signal: controller.signal, maxDurationMs: 20_000 },
      )) {
        received.push(`${event.deliveryId}:${event.attemptNumber}:${event.outcome}`);
        if (received.length > 0) controller.abort();
      }
    })();

    await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'wire.stream', payload: {} }),
    });

    await Promise.race([streamPromise, new Promise((resolve) => setTimeout(resolve, 25_000))]);
    controller.abort();
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]).toMatch(/:1:success$/);
  }, 60_000);
});
