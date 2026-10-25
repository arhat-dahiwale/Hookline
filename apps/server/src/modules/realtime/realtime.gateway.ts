import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';

import { AuthService } from '../auth/index.js';
import { EventsRepository } from '../events/index.js';
import { EndpointsRepository } from '../endpoints/index.js';
import { tenantScope } from '../platform/database/tenant-scope.js';
import {
  MAX_SOCKETS_PER_USER,
  envelope,
  parseClientMessage,
  type WsChannel,
} from './realtime.types.js';
import { RealtimeService } from './realtime.service.js';

interface SocketState {
  registryKey: object;
  organizationId: string;
  alive: boolean;
}

/**
 * WebSocket gateway at /ws (API.md section 4). The handshake is
 * authenticated with the Better Auth session cookie; subscriptions are
 * scoped to the session's active organization. Message handling bypasses
 * Nest's {event,data} envelope on purpose — the wire format is the API.md
 * `{op, channel}` contract, parsed and validated in this gateway.
 */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: unknown;

  private readonly states = new Map<WebSocket, SocketState>();
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(
    private readonly authService: AuthService,
    private readonly realtime: RealtimeService,
    private readonly endpointsRepository: EndpointsRepository,
    private readonly eventsRepository: EventsRepository,
  ) {}

  afterInit(): void {
    // Server pings every 25s; a socket that missed one pong is dead and
    // terminated (API.md heartbeat contract, 10s effective window).
    this.heartbeat = setInterval(() => {
      for (const [client, state] of this.states) {
        if (!state.alive) {
          client.terminate();
          continue;
        }
        state.alive = false;
        try {
          client.ping();
        } catch {
          client.terminate();
        }
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  async handleConnection(client: WebSocket, request: IncomingMessage): Promise<void> {
    // Queue client messages from the very first tick: the auth check below
    // awaits a DB round-trip, and `ws` only dispatches to listeners attached
    // at dispatch time — early frames (the client's first ping/subscribe)
    // would otherwise be dropped.
    const earlyMessages: string[] = [];
    const collectEarly = (raw: unknown): void => {
      earlyMessages.push(typeof raw === 'string' ? raw : String(raw));
    };
    client.on('message', collectEarly);
    const queuedPongs: (() => void)[] = [];
    client.on('pong', () => {
      for (const flush of queuedPongs.splice(0)) flush();
    });

    try {
      await this.doHandleConnection(client, request, earlyMessages, queuedPongs);
    } catch (error) {
      this.logger.error(`ws handshake failed: ${error instanceof Error ? error.message : error}`);
      client.close(1011, 'internal error');
    }
    client.off('message', collectEarly);
  }

  private async doHandleConnection(
    client: WebSocket,
    request: IncomingMessage,
    earlyMessages: string[],
    queuedPongs: (() => void)[],
  ): Promise<void> {
    const session = await this.authService.resolveSession(request.headers.cookie).catch(() => null);
    if (!session) {
      client.close(4401, 'unauthorized');
      return;
    }
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      client.close(4403, 'no active organization');
      return;
    }
    if (this.realtime.socketCount(session.user.id) >= MAX_SOCKETS_PER_USER) {
      client.close(4429, 'too many connections');
      return;
    }

    const registryKey = {};
    this.realtime.registerSocket(registryKey, {
      userId: session.user.id,
      organizationId,
      send: (message) => client.send(JSON.stringify(message)),
    });
    const state: SocketState = { registryKey, organizationId, alive: true };
    this.states.set(client, state);

    client.on('pong', () => {
      state.alive = true;
    });
    client.on('message', (raw: unknown) => {
      void this.handleMessage(client, state, typeof raw === 'string' ? raw : String(raw));
    });
    // Replay anything the client sent during the auth round-trip. The pong
    // bookkeeping is primed so heartbeat pings in flight are not lost.
    state.alive = true;
    queuedPongs.push(() => {
      state.alive = true;
    });
    for (const raw of earlyMessages.splice(0)) {
      void this.handleMessage(client, state, raw);
    }
    this.logger.debug(`ws connected (user ${session.user.id})`);
  }

  handleDisconnect(client: WebSocket): void {
    const state = this.states.get(client);
    if (state) {
      this.realtime.unregisterSocket(state.registryKey);
      this.states.delete(client);
    }
  }

  private async handleMessage(client: WebSocket, state: SocketState, raw: string): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) {
      this.send(client, envelope('error', { code: 'bad_request', message: 'malformed message' }));
      return;
    }
    if (message.op === 'ping') {
      this.send(client, envelope('pong', {}));
      return;
    }
    if (!(await this.channelAllowed(state.organizationId, message.channel))) {
      client.close(4403, 'forbidden subscription');
      return;
    }
    if (message.op === 'subscribe') {
      this.realtime.subscribe(state.registryKey, message.channel);
    } else {
      this.realtime.unsubscribe(state.registryKey, message.channel);
    }
    this.send(client, envelope('subscribed', { channel: message.channel }));
  }

  /** `org` is always allowed; resource channels must belong to the org. */
  private async channelAllowed(organizationId: string, channel: WsChannel): Promise<boolean> {
    if (channel === 'org') return true;
    const [kind, id] = channel.split(':') as ['endpoint' | 'event', string];
    try {
      const scope = tenantScope(organizationId);
      if (kind === 'endpoint') {
        return (await this.endpointsRepository.findById(scope, id)) !== null;
      }
      return (await this.eventsRepository.findById(scope, id)) !== null;
    } catch {
      return false;
    }
  }

  private send(client: WebSocket, message: { type: string; ts: string; data: unknown }): void {
    try {
      client.send(JSON.stringify(message));
    } catch {
      // socket closing concurrently; heartbeat cleanup handles it
    }
  }
}
