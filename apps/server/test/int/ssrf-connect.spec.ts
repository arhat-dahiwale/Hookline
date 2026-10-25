import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SsrfHttpClient } from '../../src/modules/delivery-engine/index.js';
import { TestReceiver } from './support/test-receiver.js';

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
