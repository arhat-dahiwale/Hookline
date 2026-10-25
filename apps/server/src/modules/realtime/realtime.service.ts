import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Redis from 'ioredis';

import { RedisService } from '../platform/redis/redis.service.js';
import { envelope, type WsChannel, type WsEnvelope } from './realtime.types.js';

interface RegisteredSocket {
  userId: string;
  organizationId: string;
  subscribedOrg: boolean;
  endpointIds: Set<string>;
  eventIds: Set<string>;
}

type FanoutTarget = RegisteredSocket & { send: (envelope: WsEnvelope) => void };

const ORG_CHANNEL_PREFIX = 'hl:org:';

/**
 * Real-time fan-out (API.md section 4, ARCHITECTURE.md 7.4): workers publish
 * bus events to Redis `hl:org:{orgId}`; API instances subscribe per org with
 * local sockets and deliver the envelope to matching subscriptions.
 *
 * Redis is the only cross-instance transport — everything here is safe to
 * lose (clients resubscribe and backfill via deliveries.since).
 */
@Injectable()
export class RealtimeService implements OnApplicationShutdown, OnModuleInit {
  private readonly sockets = new Map<object, FanoutTarget>();
  /** Org ids with at least one local socket → we subscribe on Redis. */
  private readonly orgRefCounts = new Map<string, number>();
  private subscriber: Redis | null = null;
  private bridgeConnection: Redis | null = null;
  private busListenerAttached = false;

  constructor(
    private readonly redis: RedisService,
    private readonly emitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.attachBusBridge();
  }

  /** Attaches the in-process bus → Redis publisher (called once at boot). */
  attachBusBridge(): void {
    if (this.busListenerAttached) return;
    this.busListenerAttached = true;
    const publish = (organizationId: string, type: WsEnvelope['type'], data: unknown): void => {
      void this.publish(organizationId, envelope(type, data));
    };
    this.emitter.on(
      'event.created',
      (payload: { organizationId: string; event: unknown; deliveries: unknown }) =>
        publish(payload.organizationId, 'event.created', {
          event: payload.event,
          deliveries: payload.deliveries,
        }),
    );
    this.emitter.on('delivery.created', (payload: { organizationId: string; delivery: unknown }) =>
      publish(payload.organizationId, 'delivery.created', { delivery: payload.delivery }),
    );
    this.emitter.on(
      'delivery.attempt.completed',
      (payload: { organizationId: string } & Record<string, unknown>) =>
        publish(payload.organizationId, 'delivery.attempt.completed', payload),
    );
    this.emitter.on(
      'delivery.status.changed',
      (payload: { organizationId: string } & Record<string, unknown>) =>
        publish(payload.organizationId, 'delivery.status.changed', payload),
    );
    this.emitter.on(
      'endpoint.health.changed',
      (payload: { organizationId: string } & Record<string, unknown>) =>
        publish(payload.organizationId, 'endpoint.health.changed', payload),
    );
    this.emitter.on(
      'endpoint.auto_disabled',
      (payload: { organizationId: string; endpointId: string; reason: string }) =>
        publish(payload.organizationId, 'endpoint.auto_disabled', payload),
    );
  }

  /** Registers a socket; returns an unsubscriber for disconnect. */
  registerSocket(
    socketKey: object,
    target: {
      userId: string;
      organizationId: string;
      send: (envelope: WsEnvelope) => void;
    },
  ): void {
    this.sockets.set(socketKey, {
      userId: target.userId,
      organizationId: target.organizationId,
      subscribedOrg: false,
      endpointIds: new Set(),
      eventIds: new Set(),
      send: target.send,
    });
    this.acquireOrg(target.organizationId);
  }

  unregisterSocket(socketKey: object): void {
    const socket = this.sockets.get(socketKey);
    if (!socket) return;
    this.sockets.delete(socketKey);
    this.releaseOrg(socket.organizationId);
  }

  socketCount(userId: string): number {
    let count = 0;
    for (const socket of this.sockets.values()) {
      if (socket.userId === userId) count += 1;
    }
    return count;
  }

  subscribe(socketKey: object, channel: WsChannel): boolean {
    const socket = this.sockets.get(socketKey);
    if (!socket) return false;
    if (channel === 'org') {
      socket.subscribedOrg = true;
      return true;
    }
    const [kind, id] = channel.split(':') as ['endpoint' | 'event', string];
    if (kind === 'endpoint') socket.endpointIds.add(id);
    else socket.eventIds.add(id);
    return true;
  }

  unsubscribe(socketKey: object, channel: WsChannel): boolean {
    const socket = this.sockets.get(socketKey);
    if (!socket) return false;
    if (channel === 'org') {
      socket.subscribedOrg = false;
      return true;
    }
    const [kind, id] = channel.split(':') as ['endpoint' | 'event', string];
    if (kind === 'endpoint') socket.endpointIds.delete(id);
    else socket.eventIds.delete(id);
    return true;
  }

  /** Publishes an envelope to the org channel (workers and APIs call this). */
  async publish(organizationId: string, message: WsEnvelope): Promise<void> {
    await this.bridge().publish(`${ORG_CHANNEL_PREFIX}${organizationId}`, JSON.stringify(message));
  }

  private bridge(): Redis {
    if (!this.bridgeConnection) {
      // Publishing over the shared client is fine, but BullMQ's connection
      // duplication rules apply; a dedicated connection keeps semantics clear.
      this.bridgeConnection = this.redis.duplicateForBullMq();
    }
    return this.bridgeConnection;
  }

  private subscriberClient(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.redis.duplicateForBullMq();
      this.subscriber.on('message', (channel, raw) => {
        if (!channel.startsWith(ORG_CHANNEL_PREFIX)) return;
        const organizationId = channel.slice(ORG_CHANNEL_PREFIX.length);
        this.fanOut(organizationId, raw as string);
      });
    }
    return this.subscriber;
  }

  private acquireOrg(organizationId: string): void {
    const current = this.orgRefCounts.get(organizationId) ?? 0;
    this.orgRefCounts.set(organizationId, current + 1);
    if (current === 0) {
      void this.subscriberClient().subscribe(`${ORG_CHANNEL_PREFIX}${organizationId}`);
    }
  }

  private releaseOrg(organizationId: string): void {
    const current = this.orgRefCounts.get(organizationId) ?? 0;
    if (current <= 1) {
      this.orgRefCounts.delete(organizationId);
      if (this.subscriber) {
        void this.subscriber.unsubscribe(`${ORG_CHANNEL_PREFIX}${organizationId}`);
      }
      return;
    }
    this.orgRefCounts.set(organizationId, current - 1);
  }

  /** Delivers an envelope to local sockets whose subscription matches. */
  private fanOut(organizationId: string, raw: string): void {
    let message: WsEnvelope;
    try {
      message = JSON.parse(raw) as WsEnvelope;
    } catch {
      return;
    }
    const data = message.data as
      | { deliveryId?: string; endpointId?: string; delivery?: { id: string; endpointId: string } }
      | undefined;
    const deliveryId = data?.deliveryId ?? data?.delivery?.id;
    const endpointId = data?.endpointId ?? data?.delivery?.endpointId;

    for (const socket of this.sockets.values()) {
      if (socket.organizationId !== organizationId) continue;
      if (
        !socket.subscribedOrg &&
        !(deliveryId && socket.eventIds.has(deliveryId)) &&
        !(endpointId && socket.endpointIds.has(endpointId))
      ) {
        continue;
      }
      try {
        socket.send(message);
      } catch {
        // Dead socket between heartbeat intervals; cleanup happens on close.
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.subscriber) await this.subscriber.quit().catch(() => undefined);
    if (this.bridgeConnection) await this.bridgeConnection.quit().catch(() => undefined);
  }
}
