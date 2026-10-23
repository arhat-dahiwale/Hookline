import { describe, expect, it } from 'vitest';

import { validateEndpointUrl } from './ssrf.js';

const strict = { allowInsecure: false };
const insecure = { allowInsecure: true };

describe('validateEndpointUrl (strict)', () => {
  it('accepts normal https URLs', () => {
    expect(validateEndpointUrl('https://example.com/hooks', strict).ok).toBe(true);
    expect(validateEndpointUrl('https://api.example.com:8443/hook?a=b', strict).ok).toBe(true);
  });

  it('rejects non-https and malformed URLs', () => {
    expect(validateEndpointUrl('http://example.com/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('ftp://example.com', strict).ok).toBe(false);
    expect(validateEndpointUrl('not a url', strict).ok).toBe(false);
  });

  it('rejects credentials', () => {
    expect(validateEndpointUrl('https://user:pw@example.com/hook', strict).ok).toBe(false);
  });

  it('rejects localhost-style hostnames', () => {
    expect(validateEndpointUrl('https://localhost/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('https://sub.localhost/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('https://box.local/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('https://db.internal/hook', strict).ok).toBe(false);
  });

  it('rejects private and reserved IPv4 ranges', () => {
    for (const ip of [
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://172.16.1.1/hook',
      'https://192.168.1.10/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://0.0.0.0/hook',
      'https://100.64.0.1/hook',
      'https://198.18.0.5/hook',
    ]) {
      expect(validateEndpointUrl(ip, strict).ok, ip).toBe(false);
    }
  });

  it('rejects blocked IPv6 literals', () => {
    expect(validateEndpointUrl('https://[::1]/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('https://[::]/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('https://[fe80::1]/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('https://[fc00::1]/hook', strict).ok).toBe(false);
    expect(validateEndpointUrl('https://[::ffff:127.0.0.1]/hook', strict).ok).toBe(false);
  });

  it('accepts public IPv6 literals', () => {
    expect(validateEndpointUrl('https://[2606:4700::6810:85e5]/hook', strict).ok).toBe(true);
  });
});

describe('validateEndpointUrl (dev allowInsecure)', () => {
  it('allows http and localhost for local test receivers', () => {
    expect(validateEndpointUrl('http://127.0.0.1:9999/hook', insecure).ok).toBe(true);
    expect(validateEndpointUrl('http://localhost:9999/hook', insecure).ok).toBe(true);
  });

  it('still rejects malformed URLs and foreign schemes', () => {
    expect(validateEndpointUrl('nonsense', insecure).ok).toBe(false);
    expect(validateEndpointUrl('ftp://x', insecure).ok).toBe(false);
  });
});
