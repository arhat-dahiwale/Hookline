import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeysService } from '../../src/modules/api-keys/index.js';
import { DeliveriesRepository } from '../../src/modules/deliveries/index.js';
import { EndpointsRepository } from '../../src/modules/endpoints/index.js';
import { SsrfHttpClient } from '../../src/modules/delivery-engine/index.js';
import { SecretCipher } from '../../src/modules/platform/crypto/secret-cipher.js';
import { tenantScope } from '../../src/modules/platform/index.js';
import { WORKER_OPERATIONS } from '../../src/modules/worker-ops/index.js';
import type { WorkerOperationsService } from '../../src/modules/worker-ops/index.js';
import { TestReceiver } from './support/test-receiver.js';
import { createTestApplication, type TestApplication } from './test-app.js';

/**
 * Connect-time SSRF blocking with ALLOW_INSECURE_ENDPOINTS OFF (production
 * posture). The shared ssrf.spec.ts covers URL VALIDATION and isBlockedIp;
 * this proves the runtime gate on the actual outbound client: a client built
 * with allowInsecure=false refuses blocked targets BEFORE any connection and
 * the receiver is never contacted.
 *
 * Two historical bugs these tests pin shut:
 * 1. Node's net.connect SKIPS the custom lookup for IP-literal hosts, so
 *    literals connected unchecked (URL-validation had masked it).
 * 2. isBlockedIp's IPv4 regex had lost its backslashes — every private IPv4
 *    range passed the connect-time check.
 */
describe('connect-time SSRF blocking (allowInsecure=false)', () => {
  let receiver: TestReceiver;
  let client: SsrfHttpClient;
  let port: string;

  beforeAll(async () => {
    receiver = new TestReceiver();
    await receiver.start();
    port = new URL(receiver.url).port;
    client = new SsrfHttpClient({ allowInsecure: false });
  });

  afterAll(async () => {
    await client.close();
    await receiver.stop().catch(() => undefined);
  });

  function send(url: string) {
    return client.send(url, { 'content-type': 'application/json' }, '{}', 2_000);
  }

  function expectBlocked(
    promise: Promise<{
      outcome: string;
      responseStatus: number | null;
      errorMessage: string | null;
    }>,
  ) {
    return promise.then((result) => {
      expect(result.outcome).toBe('blocked');
      expect(result.responseStatus).toBeNull();
      expect(result.errorMessage).toContain('blocked');
    });
  }

  it('blocks a loopback IPv4 target and the receiver is never contacted', async () => {
    await expectBlocked(send(`http://127.0.0.1:${port}/ok`));
    expect(receiver.received('/ok')).toHaveLength(0);
  });

  it('blocks private ranges 10.x, 172.16.x and 192.168.x', async () => {
    await expectBlocked(send('http://10.0.0.5:9000/hook'));
    await expectBlocked(send('http://172.16.0.9:9000/hook'));
    await expectBlocked(send('http://192.168.1.1:9000/hook'));
  });

  it('blocks the link-local metadata address', async () => {
    await expectBlocked(send('http://169.254.169.254/latest/meta-data'));
  });

  it('blocks IPv6 loopback and IPv4-mapped loopback literals', async () => {
    await expectBlocked(send(`http://[::1]:${port}/ok`));
    await expectBlocked(send(`http://[::ffff:127.0.0.1]:${port}/ok`));
    expect(receiver.received('/ok')).toHaveLength(0);
  });

  it('blocks alternate IPv4 spellings (the URL parser normalizes them)', async () => {
    // WHATWG URL normalizes decimal/hex/octal forms to the dotted quad
    // BEFORE the pre-flight check — each spelling must still be blocked.
    expect(new URL('http://2130706433/x').hostname).toBe('127.0.0.1');
    expect(new URL('http://0x7f.0.0.1/x').hostname).toBe('127.0.0.1');
    expect(new URL('http://0177.0.0.1/x').hostname).toBe('127.0.0.1');
    await expectBlocked(send(`http://2130706433:${port}/ok`));
    await expectBlocked(send(`http://0x7f.0.0.1:${port}/ok`));
    await expectBlocked(send(`http://0177.0.0.1:${port}/ok`));
    expect(receiver.received('/ok')).toHaveLength(0);
  });

  it('blocks a hostname that resolves to a private address (lookup path)', async () => {
    // 'localhost' resolves to loopback — the DNS resolution inside the
    // connect-time lookup must reject it.
    await expectBlocked(send(`http://localhost:${port}/ok`));
    expect(receiver.received('/ok')).toHaveLength(0);
  });
});

/**
 * End to end through the REAL services with the env gate off (default):
 * an endpoint row carrying a loopback URL (as if created before the policy
 * existed) must be unreachable from EVERY outbound path — test send, the
 * delivery processor behind an ingest, and replay — all of which must run
 * the same connect-time gate.
 */
describe('all outbound paths block with ALLOW_INSECURE_ENDPOINTS off', () => {
  let app: TestApplication;
  let receiver: TestReceiver;
  let ops: WorkerOperationsService;
  let orgId = '';
  let endpointId = '';
  let apiKey = '';
  let port = '';

  beforeAll(async () => {
    receiver = new TestReceiver();
    await receiver.start();
    port = new URL(receiver.url).port;
    // No env override: the production posture (gate off).
    app = await createTestApplication();
    ops = app.app.get(WORKER_OPERATIONS) as WorkerOperationsService;

    orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    apiKey = (
      await app.app.get(ApiKeysService).create(tenantScope(orgId), {
        name: 'ssrf-e2e',
        scopes: ['events:write'],
        createdByUserId: 'u',
      })
    ).secret;
    // Bypass creation-time URL validation on purpose: the connect-time gate
    // is the defense that must still hold.
    const cipher = app.app.get(SecretCipher);
    const row = await app.app.get(EndpointsRepository).insert({
      organizationId: orgId,
      url: `http://127.0.0.1:${port}/ok`,
      secretEncrypted: cipher.encrypt(`whsec_${crypto.randomUUID().replace(/-/g, '')}`),
    });
    await app.app.get(EndpointsRepository).ensureHealthRow(row.id);
    endpointId = row.id;
  });

  afterAll(async () => {
    await app.app.close();
    await receiver.stop().catch(() => undefined);
  });

  async function ingest(): Promise<string> {
    const res = await app.instance.inject({
      method: 'POST',
      url: '/v1/events',
      payload: JSON.stringify({ type: 'ssrf.e2e', payload: {} }),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(202);
    return (res.json() as { deliveries: { id: string }[] }).deliveries[0]!.id;
  }

  async function waitForAttempt(deliveryId: string): Promise<{ outcome: string | null }> {
    const repo = app.app.get(DeliveriesRepository);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const attempts = await repo.findAttempts(deliveryId);
      if (attempts.length > 0) return { outcome: attempts[0]!.outcome };
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`no attempt recorded for ${deliveryId}`);
  }

  it('TestEndpoint blocks before any connection', async () => {
    const result = await ops.testEndpoint({ organizationId: orgId, endpointId });
    expect(result.outcome).toBe('blocked');
    expect(result.responseStatus).toBeNull();
    expect(receiver.received('/ok')).toHaveLength(0);
  });

  it('the delivery processor blocks an ingested event', async () => {
    const deliveryId = await ingest();
    const attempt = await waitForAttempt(deliveryId);
    expect(attempt.outcome).toBe('blocked');
    expect(receiver.received('/ok')).toHaveLength(0);
  });

  it('replay of a delivery through the worker operations is blocked again', async () => {
    const originalId = await ingest();
    const replayed = await ops.replayDelivery({ organizationId: orgId, deliveryId: originalId });
    expect(replayed.newDeliveryId).not.toBe(originalId);
    const attempt = await waitForAttempt(replayed.newDeliveryId);
    expect(attempt.outcome).toBe('blocked');
    expect(receiver.received('/ok')).toHaveLength(0);
  });
});
