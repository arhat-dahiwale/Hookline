import { describe, expect, it } from 'vitest';

import { SecretCipher } from './secret-cipher.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

function makeCipher(): SecretCipher {
  return new SecretCipher({ ENCRYPTION_KEY: KEY });
}

describe('SecretCipher', () => {
  it('round-trips a secret', () => {
    const cipher = makeCipher();
    const blob = cipher.encrypt('whsec_abc123');
    expect(blob).toMatch(/^v1\./);
    expect(cipher.decrypt(blob)).toBe('whsec_abc123');
  });

  it('uses a fresh IV per encryption (distinct blobs)', () => {
    const cipher = makeCipher();
    const a = cipher.encrypt('same-secret');
    const b = cipher.encrypt('same-secret');
    expect(a).not.toEqual(b);
  });

  it('rejects tampered ciphertext (GCM auth)', () => {
    const cipher = makeCipher();
    const blob = cipher.encrypt('whsec_abc123');
    const parts = blob.split('.');
    const tamperedCiphertext = Buffer.from('not-the-ciphertext').toString('base64');
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join('.');
    expect(() => cipher.decrypt(tampered)).toThrow(/decryption failed/);
  });

  it('rejects malformed blobs', () => {
    const cipher = makeCipher();
    expect(() => cipher.decrypt('nonsense')).toThrow(/format/);
    expect(() => cipher.decrypt('v9.a.b.c')).toThrow(/format/);
  });
});
