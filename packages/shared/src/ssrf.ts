/**
 * SSRF-safe endpoint URL validation (ARCHITECTURE.md 7.2). Shared by REST,
 * tRPC and any other surface that accepts customer URLs. Connect-time DNS/IP
 * checks happen in the delivery engine (Phase 5); this is the creation-time
 * gate.
 */

/** Blocked IPv4 networks as full 32-bit values with prefix lengths. */
const IPV4_BLOCKED = [
  { network: 0 << 24, bits: 8 }, // 0.0.0.0/8 "this network"
  { network: 10 << 24, bits: 8 }, // 10.0.0.0/8 private
  { network: (100 << 24) | (64 << 16), bits: 10 }, // 100.64.0.0/10 CGNAT
  { network: 127 << 24, bits: 8 }, // 127.0.0.0/8 loopback
  { network: (169 << 24) | (254 << 16), bits: 16 }, // 169.254.0.0/16 link-local + metadata
  { network: (172 << 24) | (16 << 16), bits: 12 }, // 172.16.0.0/12 private
  { network: (192 << 24) | (168 << 16), bits: 16 }, // 192.168.0.0/16 private
  { network: (198 << 24) | (18 << 16), bits: 15 }, // 198.18.0.0/15 benchmarking
];

function ipv4ToLong(ip: string): number {
  const parts = ip.split('.');
  return parts.reduce((acc, part) => acc * 256 + Number(part), 0) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToLong(ip);
  return IPV4_BLOCKED.some(({ network, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (network & mask) >>> 0;
  });
}

function expandIpv6(ip: string): string {
  // Handle :: expansion (but not embedded IPv4; handled separately).
  if (!ip.includes('::')) return ip;
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  return groups.join(':');
}

function isBlockedIpv6(ip: string): boolean {
  const expanded = expandIpv6(ip.toLowerCase());
  const groups = expanded.split(':').map((g) => parseInt(g || '0', 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return true;
  // ::1 loopback, :: unspecified, fc00::/7 unique local, fe80::/10 link local
  if (groups.every((g) => g === 0)) return true;
  const isLoopback = groups.every((g, i) => (i === 7 ? g === 1 : g === 0));
  if (isLoopback) return true;
  if ((groups[0]! & 0xfe00) === 0xfc00) return true;
  if ((groups[0]! & 0xffc0) === 0xfe80) return true;
  // IPv4-mapped ::ffff:a.b.c.d — check the embedded v4.
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5]! === 0xffff
  ) {
    const embedded = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
    return isBlockedIpv4(embedded);
  }
  return false;
}

export interface UrlValidationOptions {
  /** Dev-only escape hatch (ALLOW_INSECURE_ENDPOINTS): allow http and
   * localhost so local test receivers can be exercised. */
  allowInsecure: boolean;
}

export interface UrlValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateEndpointUrl(
  rawUrl: string,
  options: UrlValidationOptions,
): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }

  if (url.protocol !== 'https:' && !(options.allowInsecure && url.protocol === 'http:')) {
    return { ok: false, reason: 'only https URLs are allowed' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials in URL are not allowed' };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    if (options.allowInsecure) return { ok: true };
    return { ok: false, reason: 'local hostnames are not allowed' };
  }

  // Looks like an IPv4 literal?
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isBlockedIpv4(host)) {
      if (options.allowInsecure) return { ok: true };
      return { ok: false, reason: 'private or reserved IP ranges are not allowed' };
    }
    return { ok: true };
  }

  // IPv6 literal (contains colons after bracket stripping)?
  if (host.includes(':')) {
    if (isBlockedIpv6(host)) {
      if (options.allowInsecure) return { ok: true };
      return { ok: false, reason: 'private or reserved IP ranges are not allowed' };
    }
    return { ok: true };
  }

  return { ok: true };
}
