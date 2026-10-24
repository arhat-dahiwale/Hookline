'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';

import { DeliveryStatusBadge } from '@/components/status-badge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateTime } from '@/lib/format';
import { trpc } from '@/lib/trpc';

const PAGE_SIZE = 25;
const STATUSES = ['pending', 'in_progress', 'retrying', 'succeeded', 'dead', 'cancelled'] as const;

/**
 * Deliveries list (API.md deliveries.*): status filter, cursor pagination,
 * and admin-only bulk replay of dead deliveries for the current filter.
 */
export default function DeliveriesPage() {
  const [status, setStatus] = useState<string>('all');
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1] ?? null;

  const list = trpc.deliveries.list.useQuery({
    status: status === 'all' ? undefined : (status as (typeof STATUSES)[number]),
    limit: PAGE_SIZE,
    cursor: cursor ?? undefined,
  });

  const bulkReplay = trpc.deliveries.replayBulk.useMutation({
    onSuccess: (result) => {
      void list.refetch();
      setBulkNote(`${result.deliveries.length} replay(s) queued`);
    },
  });
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deliveries</h1>
          <p className="text-sm text-muted-foreground">
            Every send attempt against your endpoints.
          </p>
        </div>
        <Button
          variant="outline"
          data-testid="bulk-replay"
          disabled={bulkReplay.isPending}
          onClick={() => {
            setBulkNote(null);
            bulkReplay.mutate({ status: 'dead' });
          }}
        >
          {bulkReplay.isPending ? 'Replaying…' : 'Replay all dead'}
        </Button>
      </div>

      {bulkReplay.error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="bulk-replay-error">
          {bulkReplay.error.message}
        </p>
      ) : null}
      {bulkNote ? (
        <p className="text-sm" data-testid="bulk-replay-result">
          <Badge variant="secondary">{bulkNote}</Badge>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setCursorStack([null]);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter deliveries by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.isPending ? (
        <LoadingBlock label="Loading deliveries" />
      ) : list.isError ? (
        <ErrorBlock
          title="Could not load deliveries"
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : list.data.data.length === 0 ? (
        <EmptyBlock
          title="No deliveries found"
          description="Deliveries appear as soon as events fan out to endpoints."
          testId="deliveries-empty"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Delivery</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Attempts</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Last response</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody data-testid="deliveries-table">
              <AnimatePresence initial={false}>
                {list.data.data.map((delivery) => (
                  <motion.tr
                    key={delivery.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-t transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/deliveries/${delivery.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {delivery.id}
                      </Link>
                      {delivery.replayOfDeliveryId ? (
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                          replay
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <DeliveryStatusBadge status={delivery.status} />
                    </td>
                    <td className="px-4 py-3">
                      {delivery.attemptCount}/{delivery.maxAttempts}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {delivery.lastResponseStatus ?? delivery.lastError ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(delivery.createdAt)}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={cursorStack.length <= 1 || list.isPending}
          onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!list.data?.nextCursor || list.isPending}
          data-testid="deliveries-next"
          onClick={() => {
            const next = list.data?.nextCursor;
            if (next) setCursorStack((stack) => [...stack, next]);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
