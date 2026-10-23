import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const KEY_ID = 'v1';
const IV_BYTES = 12;

/**
 * AES-256-GCM encryption for endpoint signing secrets (ARCHITECTURE.md 7.2).
 * Blob format: `{keyId}.{iv_b64}.{tag_b64}.{ciphertext_b64}` — the key-id
 * prefix allows future key rotation without re-encrypting old secrets.
 */
export class SecretCipher {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'ENCRYPTION_KEY'>) {
    this.key = Buffer.from(config.ENCRYPTION_KEY, 'base64');
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      KEY_ID,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.');
  }

  decrypt(blob: string): string {
    const parts = blob.split('.');
    if (parts.length !== 4 || parts[0] !== KEY_ID) {
      throw new Error('unrecognized secret blob format');
    }
    const [, ivB64, tagB64, ciphertextB64] = parts;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64!, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextB64!, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      // GCM auth failure or corrupted blob: never surface internals.
      throw new Error('secret decryption failed');
    }
  }
}
