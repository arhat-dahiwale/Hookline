'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { DeliveryStatusBadge } from '@/components/status-badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useUiStore } from '@/store/ui-store';
import { useLiveDeliveryFeed, type LiveFeedStatus } from '@/lib/live-feed';
import type { WsEnvelope } from '@hookline/server/trpc-router';

interface LiveRow {
  deliveryId: string;
  status: string;
  ts: string;
}

const MAX_ROWS = 50;

function rowKey(row: LiveRow): string {
  return `${row.deliveryId}:${row.ts}`;
}

/**
 * Live delivery log (API.md section 4): rows appear and change status without
 * a refresh. The pause toggle (UI state, Zustand) freezes the visible list —
 * updates keep buffering and are applied on resume. After a reconnect the
 * caller backfills via deliveries.since so nothing is missed.
 */
export function LiveLog({
  onBackfill,
  onDeliveryChanged,
}: {
  onBackfill: (sinceIso: string) => void;
  /** Fired (throttled by the drain tick) when a delivery row updates live. */
  onDeliveryChanged?: () => void;
}) {
  const paused = useUiStore((state) => state.liveLogPaused);
  const setPaused = useUiStore((state) => state.setLiveLogPaused);
  const onDeliveryChangedRef = useRef(onDeliveryChanged);
  onDeliveryChangedRef.current = onDeliveryChanged;

  const [rows, setRows] = useState<LiveRow[]>([]);
  const [connection, setConnection] = useState<LiveFeedStatus>('connecting');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const pausedBufferRef = useRef<LiveRow[]>([]);
  const lastTsRef = useRef<string | null>(null);

  const applyRows = (incoming: LiveRow[]): void => {
    setRows((current) => [...incoming, ...current].slice(0, MAX_ROWS));
  };

  const ingest = (envelopes: WsEnvelope[]): void => {
    const statusUpdates: LiveRow[] = [];
    for (const message of envelopes) {
      if (message.type !== 'delivery.status.changed' && message.type !== 'delivery.created')
        continue;
      const data = message.data as {
        deliveryId?: string;
        status?: string;
        delivery?: { id: string; status?: string };
      };
      const deliveryId = data.deliveryId ?? data.delivery?.id;
      const status = data.status ?? data.delivery?.status;
      if (!deliveryId || !status) continue;
      const row: LiveRow = { deliveryId, status, ts: message.ts };
      if (lastTsRef.current === null || message.ts > lastTsRef.current) {
        lastTsRef.current = message.ts;
      }
      if (pausedRef.current) {
        pausedBufferRef.current.unshift(row);
      } else {
        statusUpdates.unshift(row);
      }
    }
    if (pausedBufferRef.current.length > MAX_ROWS) {
      pausedBufferRef.current.length = MAX_ROWS;
    }
    if (statusUpdates.length > 0) {
      applyRows(statusUpdates);
      onDeliveryChangedRef.current?.();
    }
  };

  const feed = useLiveDeliveryFeed({
    onOpenAfterReconnect: () => {
      // Missed updates since the last seen event; the page merges them.
      if (lastTsRef.current) onBackfill(lastTsRef.current);
    },
  });

  useEffect(() => {
    setConnection(feed.status);
  }, [feed.status]);

  useEffect(() => {
    // Drain the transport inbox on a timer so bursts cost one render. The
    // drain closure only touches refs, so it never needs re-arming.
    const drain = setInterval(() => {
      const envelopes = feed.takeEnvelopes();
      if (envelopes.length > 0) ingest(envelopes);
    }, 250);
    return () => clearInterval(drain);
  }, [feed.takeEnvelopes]);

  const resume = (): void => {
    setPaused(false);
    const buffered = pausedBufferRef.current.splice(0, pausedBufferRef.current.length);
    if (buffered.length > 0) applyRows(buffered);
  };

  const statusColor =
    connection === 'open'
      ? 'bg-[var(--success)]'
      : connection === 'connecting'
        ? 'bg-[var(--warning)]'
        : 'bg-destructive';

  return (
    <section aria-label="Live delivery log" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={`inline-block size-2 rounded-full ${statusColor}`} aria-hidden />
          Live log
          <span className="text-xs font-normal text-muted-foreground">
            {connection === 'open'
              ? 'connected'
              : connection === 'connecting'
                ? 'connecting…'
                : 'reconnecting…'}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="live-pause" className="text-xs text-muted-foreground">
            {paused ? `Paused (${pausedBufferRef.current.length} buffered)` : 'Live'}
          </Label>
          <Switch
            id="live-pause"
            checked={!paused}
            onCheckedChange={(checked) => (checked ? resume() : setPaused(true))}
            aria-label="Pause or resume the live log"
            data-testid="live-pause"
          />
        </div>
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs" data-testid="live-log">
        {rows.length === 0 ? (
          <li className="px-2 py-3 font-sans text-muted-foreground">
            Waiting for delivery updates — send an event to see it appear here without a refresh.
          </li>
        ) : null}
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={rowKey(row)}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-2 py-1.5"
            >
              <Link
                href={`/deliveries/${row.deliveryId}`}
                className="truncate underline-offset-4 hover:underline"
              >
                {row.deliveryId}
              </Link>
              <span className="flex items-center gap-2">
                <DeliveryStatusBadge status={row.status} />
                <span className="text-muted-foreground">
                  {new Date(row.ts).toLocaleTimeString()}
                </span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
