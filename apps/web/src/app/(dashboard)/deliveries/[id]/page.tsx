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
import { formatDateTime, formatDuration } from '@/lib/format';
import { trpc } from '@/lib/trpc';

/**
 * Delivery detail: attempt timeline (each attempt expandable into the
 * request/response inspector) and single replay. Admin-only replay; the
 * server enforces the role.
 */
export default function DeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const utils = trpc.useUtils();
  const [openAttempt, setOpenAttempt] = useState<string | null>(null);
  const [replayNote, setReplayNote] = useState<string | null>(null);

  const delivery = trpc.deliveries.get.useQuery({ id });
  const attempts = trpc.deliveries.attempts.useQuery({ id });

  const replay = trpc.deliveries.replay.useMutation({
    onSuccess: (result) => {
      setReplayNote(`Replay queued: ${result.id}`);
      void utils.deliveries.list.invalidate();
    },
  });

  if (delivery.isPending) return <LoadingBlock label="Loading delivery" />;
  if (delivery.isError) {
    return (
      <ErrorBlock
        title="Could not load delivery"
        error={delivery.error}
        onRetry={() => void delivery.refetch()}
      />
    );
  }
  const d = delivery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/deliveries" className="text-sm text-muted-foreground hover:underline">
            ← Deliveries
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            <span className="font-mono text-lg">{d.id}</span>
            <DeliveryStatusBadge status={d.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            <Link href={`/events/${d.eventId}`} className="underline-offset-4 hover:underline">
              event {d.eventId}
            </Link>
            {' · '}
            <Link
              href={`/endpoints/${d.endpointId}`}
              className="underline-offset-4 hover:underline"
            >
              endpoint {d.endpointId}
            </Link>
            {d.replayOfDeliveryId ? ` · replay of ${d.replayOfDeliveryId}` : ''}
          </p>
        </div>
        <Button
          onClick={() => replay.mutate({ id })}
          disabled={replay.isPending}
          data-testid="replay-delivery"
        >
          {replay.isPending ? 'Replaying…' : 'Replay'}
        </Button>
      </div>

      {replay.error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="replay-delivery-error">
          {replay.error.message}
        </p>
      ) : null}
      {replayNote ? (
        <p className="text-sm" data-testid="replay-delivery-result">
          <Badge variant="secondary">{replayNote}</Badge>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <SummaryRow label="Attempts" value={`${d.attemptCount}/${d.maxAttempts}`} />
          <SummaryRow
            label="Last response"
            value={d.lastResponseStatus ? String(d.lastResponseStatus) : '—'}
          />
          <SummaryRow label="Last error" value={d.lastError ?? '—'} />
          <SummaryRow label="Created" value={formatDateTime(d.createdAt)} />
          <SummaryRow label="Last attempt" value={formatDateTime(d.lastAttemptAt)} />
          <SummaryRow label="Completed" value={formatDateTime(d.completedAt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attempt timeline</CardTitle>
          <CardDescription>
            Oldest first. Click an attempt to inspect request and response.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attempts.isPending ? (
            <p className="text-sm text-muted-foreground">Loading attempts…</p>
          ) : attempts.isError ? (
            <p className="text-sm text-destructive">{attempts.error.message}</p>
          ) : attempts.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="attempts-empty">
              No attempts recorded yet.
            </p>
          ) : (
            <ol className="space-y-2" data-testid="attempt-timeline">
              <AnimatePresence initial={false}>
                {attempts.data.data.map((attempt) => {
                  const open = openAttempt === attempt.id;
                  return (
                    <motion.li
                      key={attempt.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-md border"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-muted/30"
                        aria-expanded={open}
                        onClick={() => setOpenAttempt(open ? null : attempt.id)}
                      >
                        <span className="flex items-center gap-3">
                          <span className="font-medium">Attempt {attempt.attemptNumber}</span>
                          <Badge
                            variant={
                              attempt.outcome === 'success'
                                ? 'success'
                                : attempt.outcome === 'timeout' ||
                                    attempt.outcome === 'network_error'
                                  ? 'warning'
                                  : 'destructive'
                            }
                          >
                            {attempt.outcome}
                          </Badge>
                          {attempt.responseStatus ? (
                            <span>HTTP {attempt.responseStatus}</span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDuration(attempt.durationMs)} · {formatDateTime(attempt.startedAt)}
                        </span>
                      </button>
                      {open ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          className="overflow-hidden border-t"
                        >
                          <div className="grid gap-4 p-4 md:grid-cols-2">
                            <Inspector title="Request headers" json={attempt.requestHeaders} />
                            <Inspector title="Response headers" json={attempt.responseHeaders} />
                            <div className="md:col-span-2">
                              <p className="mb-1 text-xs font-medium text-muted-foreground">
                                Response body (truncated)
                              </p>
                              <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
                                {attempt.responseBodySnippet ?? '—'}
                              </pre>
                              {attempt.errorMessage ? (
                                <p className="mt-2 text-sm text-destructive">
                                  {attempt.errorMessage}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </motion.div>
                      ) : null}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[70%] truncate text-right font-medium">{value}</span>
    </div>
  );
}

function Inspector({ title, json }: { title: string; json: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
        {JSON.stringify(json, null, 2)}
      </pre>
    </div>
  );
}
