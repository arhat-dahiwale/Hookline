'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { DeliveryStatusBadge } from '@/components/status-badge';
import { ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { trpc } from '@/lib/trpc';

/** Event detail: payload inspector, its deliveries and event-level replay. */
export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const utils = trpc.useUtils();
  const [replayNote, setReplayNote] = useState<string | null>(null);

  const event = trpc.events.get.useQuery({ id });
  const deliveries = trpc.deliveries.list.useQuery({ eventId: id });

  const replay = trpc.events.replay.useMutation({
    onSuccess: (result) => {
      setReplayNote(`${result.deliveries.length} delivery(ies) queued`);
      void utils.deliveries.list.invalidate({ eventId: id });
    },
  });

  if (event.isPending) return <LoadingBlock label="Loading event" />;
  if (event.isError) {
    return (
      <ErrorBlock
        title="Could not load event"
        error={event.error}
        onRetry={() => void event.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/events" className="text-sm text-muted-foreground hover:underline">
            ← Events
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{event.data.type}</h1>
          <p className="font-mono text-xs text-muted-foreground">{event.data.id}</p>
          <p className="text-sm text-muted-foreground">{formatDateTime(event.data.createdAt)}</p>
        </div>
        <Button
          onClick={() => replay.mutate({ id })}
          disabled={replay.isPending}
          data-testid="replay-event"
        >
          {replay.isPending ? 'Replaying…' : 'Replay to matching endpoints'}
        </Button>
      </div>

      {replay.error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="replay-event-error">
          {replay.error.message}
        </p>
      ) : null}
      {replayNote ? (
        <p className="text-sm" data-testid="replay-event-result">
          <Badge variant="secondary">{replayNote}</Badge>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payload</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            className="max-h-96 overflow-auto rounded-md bg-muted/40 p-4 font-mono text-xs"
            data-testid="event-payload"
          >
            {JSON.stringify(event.data.payload, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deliveries</CardTitle>
          <CardDescription>One row per endpoint this event was (re)sent to.</CardDescription>
        </CardHeader>
        <CardContent>
          {deliveries.isPending ? (
            <p className="text-sm text-muted-foreground">Loading deliveries…</p>
          ) : deliveries.isError ? (
            <p className="text-sm text-destructive">{deliveries.error.message}</p>
          ) : deliveries.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="event-deliveries-empty">
              No deliveries — no active endpoint matched this event type.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Delivery</th>
                    <th className="px-4 py-2 font-medium">Endpoint</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Attempts</th>
                  </tr>
                </thead>
                <tbody data-testid="event-deliveries">
                  <AnimatePresence initial={false}>
                    {deliveries.data.data.map((delivery) => (
                      <motion.tr
                        key={delivery.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="border-t"
                      >
                        <td className="px-4 py-2 font-mono text-xs">
                          <Link
                            href={`/deliveries/${delivery.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {delivery.id}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/endpoints/${delivery.endpointId}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {delivery.endpointId}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <DeliveryStatusBadge status={delivery.status} />
                        </td>
                        <td className="px-4 py-2">
                          {delivery.attemptCount}/{delivery.maxAttempts}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
