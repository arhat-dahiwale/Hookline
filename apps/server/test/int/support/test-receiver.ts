import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Local webhook receiver for integration tests. Behavior is chosen by path:
 *   /ok            always 200
 *   /fail          always 500
 *   /flaky         500 for the first N requests per delivery id, then 200
 *   /redirect      302 to /ok (redirects must NOT be followed)
 *   /slow?ms=N     delay N ms then 200 (for timeouts)
 * Every request is recorded with headers + raw body for assertions.
 */
export interface ReceivedRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  receivedAt: number;
}

export class TestReceiver {
  private readonly server: Server;
  private readonly requests: ReceivedRequest[] = [];
  private flakyFailuresLeft = 0;
  private nextPortPromise: Promise<number> | undefined;

  constructor() {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  get url(): string {
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('receiver not listening');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  async start(): Promise<number> {
    if (this.nextPortPromise) return this.nextPortPromise;
    this.nextPortPromise = new Promise<number>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('no port'));
          return;
        }
        resolve(address.port);
      });
    });
    return this.nextPortPromise;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** All recorded requests for a path, in order. */
  received(path?: string): ReceivedRequest[] {
    return path ? this.requests.filter((r) => r.path === path) : [...this.requests];
  }

  clear(): void {
    this.requests.length = 0;
  }

  /** The next N requests to /flaky fail with 503, then it recovers. */
  failNext(times: number): void {
    this.flakyFailuresLeft = times;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    this.requests.push({
      path: url.pathname,
      headers: { ...req.headers },
      body,
      receivedAt: Date.now(),
    });

    switch (url.pathname) {
      case '/ok': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      case '/fail': {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
        return;
      }
      case '/flaky': {
        if (this.flakyFailuresLeft > 0) {
          this.flakyFailuresLeft -= 1;
          res.writeHead(503, { 'content-type': 'text/plain' });
          res.end('try again');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('recovered');
        return;
      }
      case '/redirect': {
        res.writeHead(302, { location: `${this.url}/ok` });
        res.end();
        return;
      }
      case '/slow': {
        const ms = Number(url.searchParams.get('ms') ?? '5000');
        await new Promise((resolve) => setTimeout(resolve, ms));
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('finally');
        return;
      }
      default: {
        res.writeHead(404);
        res.end();
      }
    }
  }
}
