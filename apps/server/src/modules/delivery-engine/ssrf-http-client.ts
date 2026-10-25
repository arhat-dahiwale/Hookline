import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, request } from 'undici';

import { isBlockedIp } from '@hookline/shared';
import { trace } from '@opentelemetry/api';

export type AttemptOutcome = 'success' | 'http_error' | 'timeout' | 'network_error' | 'blocked';

export interface SendResult {
  outcome: AttemptOutcome;
  responseStatus: number | null;
  responseHeaders: Record<string, string> | null;
  responseBodySnippet: string | null;
  errorMessage: string | null;
  durationMs: number;
}

const SNIPPET_LIMIT = 4 * 1024;

/**
 * Connect-time SSRF protection: resolve DNS ourselves, reject private /
 * loopback / link-local / metadata addresses (IPv4 and IPv6), then hand the
 * validated first address to the socket. TLS SNI still uses the hostname
 * because only the connection target is overridden.
 */
function ssrfLookup(allowInsecure: boolean): (
  hostname: string,
  options: LookupOptions,
  // Node net.connect contract: with autoSelectFamily the options carry
  // `all: true` and the callback takes an address array; otherwise the
  // single-address (err, address, family) form. Get either wrong and Node
  // fails the connect with "Invalid IP address: undefined".
  callback: (
    err: Error | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
) => void {
  return (hostname, options, callback) => {
    // IP-literal hosts NEVER reach dnsLookup below in practice (Node's
    // net.connect skips lookup for literals) — so the blocklist must check
    // them here, or `http://127.0.0.1:...` would connect unchecked.
    const literalFamily = isIP(hostname);
    const resolved: Promise<{ address: string; family: number }[]> = literalFamily
      ? Promise.resolve([{ address: hostname, family: literalFamily }])
      : dnsLookup(hostname, { all: true, verbatim: true });
    void resolved
      .then((addresses) => {
        if (addresses.length === 0) {
          callback(new Error(`could not resolve ${hostname}`), []);
          return;
        }
        if (!allowInsecure) {
          // Every resolved address must pass the blocklist (no partial trust).
          const blocked = addresses.find((entry) => isBlockedIp(entry.address));
          if (blocked) {
            callback(
              Object.assign(new Error(`blocked address for ${hostname}`), { code: 'SSRF_BLOCKED' }),
              [],
            );
            return;
          }
        }
        if (options.all) {
          callback(
            null,
            addresses.map((entry) => ({ address: entry.address, family: entry.family })),
          );
          return;
        }
        callback(null, addresses[0]!.address, addresses[0]!.family);
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), []);
      });
  };
}

interface LookupOptions {
  all?: boolean;
}

export interface SsrfHttpClientOptions {
  allowInsecure: boolean;
}

/**
 * Outbound HTTP for webhook delivery (worker-only, ARCHITECTURE.md 7.2):
 * per-request timeout, redirects never followed, response body truncated to
 * the first 4 KB, DNS/IP SSRF check at connect time.
 */
export class SsrfHttpClient {
  private readonly agent: Agent;
  private readonly allowInsecure: boolean;

  constructor(options: SsrfHttpClientOptions) {
    this.allowInsecure = options.allowInsecure;
    this.agent = new Agent({
      connect: {
        lookup: ssrfLookup(options.allowInsecure) as never,
      },
      // Hard caps on top of the per-endpoint timeout. undici's request()
      // never follows redirects by design.
      headersTimeout: 35_000,
      bodyTimeout: 35_000,
    });
  }

  /**
   * Explicit span for the outbound webhook: deterministic parentage (the
   * worker attempt span) instead of relying on undici auto-instrumentation.
   */
  send(
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
  ): Promise<SendResult> {
    return trace
      .getTracer('hookline.worker')
      .startActiveSpan('outbound.webhook', { attributes: { 'http.url': url } }, async (span) => {
        try {
          const result = await this.sendInternal(url, headers, body, timeoutMs);
          span.setAttribute('hookline.outcome', result.outcome);
          if (result.responseStatus !== null) {
            span.setAttribute('http.response.status_code', result.responseStatus);
          }
          return result;
        } catch (error) {
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      });
  }

  private async sendInternal(
    url: string,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
  ): Promise<SendResult> {
    const startedAt = Date.now();
    const finish = (result: Omit<SendResult, 'durationMs'>): SendResult => ({
      ...result,
      durationMs: Date.now() - startedAt,
    });

    // Pre-flight for IP-literal hosts: Node's net.connect SKIPS the custom
    // connect-time lookup for literals, so `http://127.0.0.1:...` would
    // otherwise connect unchecked. The URL parser normalizes alternate IPv4
    // spellings (decimal/hex/octal) to dotted quad, and IPv6 hostnames keep
    // their brackets — strip them, like validateEndpointUrl does. Hostnames
    // stay covered by the connect-time lookup.
    if (!this.allowInsecure) {
      const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
      if (isIP(hostname) !== 0 && isBlockedIp(hostname)) {
        return finish({
          outcome: 'blocked',
          responseStatus: null,
          responseHeaders: null,
          responseBodySnippet: null,
          errorMessage: 'target address is blocked (SSRF protection)',
        });
      }
    }

    let response;
    try {
      response = await request(url, {
        method: 'POST',
        headers,
        body,
        dispatcher: this.agent,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('blocked address')) {
        return finish({
          outcome: 'blocked',
          responseStatus: null,
          responseHeaders: null,
          responseBodySnippet: null,
          errorMessage: 'target address is blocked (SSRF protection)',
        });
      }
      const timedOut =
        error instanceof Error &&
        (('code' in error && (error as { code?: string }).code === 'UND_ERR_HEADERS_TIMEOUT') ||
          message.toLowerCase().includes('timeout') ||
          message.toLowerCase().includes('timed out'));
      return finish({
        outcome: timedOut ? 'timeout' : 'network_error',
        responseStatus: null,
        responseHeaders: null,
        responseBodySnippet: null,
        errorMessage: message,
      });
    }

    // Truncate the body to the first 4 KB then stop reading.
    let snippet = '';
    try {
      for await (const chunk of response.body) {
        snippet += Buffer.from(chunk).toString('utf8');
        if (snippet.length >= SNIPPET_LIMIT) break;
      }
      response.body.destroy();
    } catch {
      // Body failed mid-read: keep what we got; the status stands.
    }

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    return finish({
      outcome: response.statusCode >= 200 && response.statusCode < 300 ? 'success' : 'http_error',
      responseStatus: response.statusCode,
      responseHeaders,
      responseBodySnippet: snippet.slice(0, SNIPPET_LIMIT),
      errorMessage: null,
    });
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}
