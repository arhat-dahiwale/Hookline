/**
 * WebSocket contract (API.md section 4). Client → server ops and the server
 * → client envelope; shared by the gateway, the Redis bridge and tests.
 */
export interface WsSubscribeMessage {
  op: 'subscribe' | 'unsubscribe';
  channel: 'org' | `endpoint:${string}` | `event:${string}`;
}

export interface WsPingMessage {
  op: 'ping';
}

export type WsClientMessage = WsSubscribeMessage | WsPingMessage;

export type WsChannel = WsSubscribeMessage['channel'];

export interface WsEnvelope {
  type:
    | 'subscribed'
    | 'event.created'
    | 'delivery.created'
    | 'delivery.status.changed'
    | 'delivery.attempt.completed'
    | 'endpoint.health.changed'
    | 'endpoint.auto_disabled'
    | 'pong'
    | 'error';
  ts: string;
  data: unknown;
}

export const MAX_SOCKETS_PER_USER = 10;

/** Validates an incoming client message; null when malformed. */
export function parseClientMessage(raw: string): WsClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('op' in parsed)) return null;
  const candidate = parsed as { op: unknown; channel?: unknown };
  if (candidate.op === 'ping') return { op: 'ping' };
  if (candidate.op !== 'subscribe' && candidate.op !== 'unsubscribe') return null;
  if (typeof candidate.channel !== 'string') return null;
  const channel: string = candidate.channel;
  if (
    channel === 'org' ||
    /^endpoint:[A-Za-z0-9_]+$/.test(channel) ||
    /^event:[A-Za-z0-9_]+$/.test(channel)
  ) {
    return { op: candidate.op, channel: channel as WsChannel };
  }
  return null;
}

export function envelope(type: WsEnvelope['type'], data: unknown): WsEnvelope {
  return { type, ts: new Date().toISOString(), data };
}
