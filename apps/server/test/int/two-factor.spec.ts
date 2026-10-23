import { createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CookieJar, createTestApplication, type TestApplication } from './test-app.js';

let test: TestApplication;
let jar: CookieJar;

beforeAll(async () => {
  test = await createTestApplication();
  jar = new CookieJar();
});

afterAll(async () => {
  await test.app.close();
});

// --- minimal RFC 4648 base32 + RFC 6238 TOTP for the test client -----------

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret: string, timestampMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

// -----------------------------------------------------------------------------

async function call(method: string, url: string, payload?: unknown) {
  const cookie = jar.header();
  const response = await test.instance.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    headers: {
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  jar.capture(response);
  return response;
}

describe('two-factor authentication', () => {
  it('enables TOTP and gates sign-in behind a valid code', async () => {
    jar.clear();
    const email = `mfa-${randomUUID()}@example.test`;
    const password = 'password-123456';
    const signUp = await call('POST', '/api/auth/sign-up/email', {
      email,
      password,
      name: 'MFA User',
    });
    expect(signUp.statusCode).toBeLessThan(300);

    // Enable 2FA: returns the TOTP secret URI (one-time reveal).
    const enable = await call('POST', '/api/auth/two-factor/enable', { password });
    expect(enable.statusCode).toBeLessThan(300);
    const { totpURI } = enable.json() as { totpURI?: string };
    expect(totpURI).toBeDefined();
    const secret = new URL(totpURI!).searchParams.get('secret')!;
    expect(secret.length).toBeGreaterThan(10);

    // Confirm with a current code to activate.
    const verify = await call('POST', '/api/auth/two-factor/verify-totp', {
      code: totp(secret),
    });
    expect(verify.statusCode).toBeLessThan(300);

    await call('POST', '/api/auth/sign-out');

    // Password alone is no longer enough: sign-in reports the 2FA step.
    jar.clear();
    const signIn = await call('POST', '/api/auth/sign-in/email', { email, password });
    expect(signIn.statusCode).toBeLessThan(300);
    expect(signIn.json().twoFactorRedirect).toBe(true);
    const gated = await call('GET', '/api/auth/get-session');
    expect(gated.json()).toBeNull();

    // Completing the TOTP step establishes the session.
    const otp = await call('POST', '/api/auth/two-factor/verify-totp', {
      code: totp(secret),
    });
    expect(otp.statusCode).toBeLessThan(300);
    const session = await call('GET', '/api/auth/get-session');
    expect(session.json()?.user?.email).toBe(email);
  });
});
