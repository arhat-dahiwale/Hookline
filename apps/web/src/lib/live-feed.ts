'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { WsEnvelope } from '@hookline/server/trpc-router';

export type LiveFeedStatus = 'connecting' | 'open' | 'closed';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * WebSocket live feed (API.md section 4): connects to /ws with the session
 * cookie, subscribes to the `org` channel, and reconnects with exponential
 * backoff + jitter, resubscribing on every attempt. Incoming envelopes are
 * queued in a bounded inbox; consumers drain via `takeEnvelopes`.
 *
 * In dev the API port differs from the web origin, so the URL comes from
 * NEXT_PUBLIC_WS_URL (default ws://localhost:4000/ws — cookies are shared
 * across localhost ports).
 */
export function useLiveDeliveryFeed(options: { onOpenAfterReconnect?: () => void }): {
  status: LiveFeedStatus;
  takeEnvelopes: () => WsEnvelope[];
} {
  const [status, setStatus] = useState<LiveFeedStatus>('connecting');
  const inboxRef = useRef<WsEnvelope[]>([]);
  const attemptRef = useRef(0);
  const hasConnectedBeforeRef = useRef(false);
  const onOpenAfterReconnectRef = useRef(options.onOpenAfterReconnect);
  onOpenAfterReconnectRef.current = options.onOpenAfterReconnect;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws';

    const connect = (): void => {
      if (disposed) return;
      setStatus((current) => (current === 'open' ? current : 'connecting'));
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        socket?.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
        setStatus('open');
        if (hasConnectedBeforeRef.current) {
          // Reconnected: the consumer backfills what we missed.
          onOpenAfterReconnectRef.current?.();
        }
        hasConnectedBeforeRef.current = true;
        attemptRef.current = 0;
      };

      socket.onmessage = (event) => {
        const envelope = JSON.parse(String(event.data)) as WsEnvelope;
        inboxRef.current.push(envelope);
        if (inboxRef.current.length > 200) {
          inboxRef.current.splice(0, inboxRef.current.length - 200);
        }
      };

      socket.onclose = (event) => {
        setStatus('closed');
        if (disposed) return;
        // 1001 = server shutting down: reconnect immediately per API.md.
        const base = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
        const jitter = base * (0.8 + Math.random() * 0.4);
        attemptRef.current += 1;
        reconnectTimer = setTimeout(connect, Math.round(jitter));
        void event;
      };

      socket.onerror = () => {
        // onclose follows; the backoff there handles reconnection.
      };
    };

    connect();

    // Client-side heartbeat keeps intermediaries from idling the socket out.
    const heartbeat = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: 'ping' }));
      }
    }, 20_000);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(heartbeat);
      socket?.close(1000, 'component unmounted');
    };
  }, []);

  const takeEnvelopes = useCallback(
    (): WsEnvelope[] => inboxRef.current.splice(0, inboxRef.current.length),
    [],
  );

  return { status, takeEnvelopes };
}
