'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { BreakerBadge, EndpointStatusBadge } from '@/components/status-badge';
import { SecretDialog } from '@/components/secret-dialog';
import { ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatDuration } from '@/lib/format';
import { trpc } from '@/lib/trpc';

/**
 * Endpoint detail: health panel (breaker + 24h stats), test send, lifecycle
 * actions. Mutations are admin-only; the server enforces and the UI shows
 * the resulting error for members.
 */
export default function EndpointDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const utils = trpc.useUtils();
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const endpoint = trpc.endpoints.get.useQuery({ id });
  const health = trpc.endpoints.health.useQuery({ id });

  const invalidate = (): void => {
    void utils.endpoints.get.invalidate({ id });
    void utils.endpoints.health.invalidate({ id });
    void utils.endpoints.list.invalidate();
  };

  const setStatus = trpc.endpoints.setStatus.useMutation({ onSuccess: invalidate });
  const rotate = trpc.endpoints.rotateSecret.useMutation({
    onSuccess: (result) => {
      setNewSecret(result.secret);
      invalidate();
    },
  });
  const remove = trpc.endpoints.delete.useMutation({
    onSuccess: () => {
      void utils.endpoints.list.invalidate();
      window.location.href = '/endpoints';
    },
  });
  const test = trpc.endpoints.test.useMutation({
    onSuccess: (result) => {
      setTestResult(
        `${result.outcome}${result.responseStatus ? ` (HTTP ${result.responseStatus})` : ''} in ${formatDuration(result.durationMs)}${result.error ? ` — ${result.error}` : ''}`,
      );
    },
  });

  if (endpoint.isPending) return <LoadingBlock label="Loading endpoint" />;
  if (endpoint.isError) {
    return (
      <ErrorBlock
        title="Could not load endpoint"
        error={endpoint.error}
        onRetry={() => void endpoint.refetch()}
      />
    );
  }
  const data = endpoint.data;

  const actionError = setStatus.error ?? rotate.error ?? remove.error ?? test.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/endpoints" className="text-sm text-muted-foreground hover:underline">
            ← Endpoints
          </Link>
          <h1
            className="mt-1 break-all text-2xl font-semibold tracking-tight"
            data-testid="endpoint-url"
          >
            {data.url}
          </h1>
          <p className="text-sm text-muted-foreground">{data.description ?? 'No description'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EndpointStatusBadge status={data.status} />
          <Button
            variant="outline"
            size="sm"
            disabled={setStatus.isPending}
            data-testid="toggle-endpoint"
            onClick={() =>
              setStatus.mutate({ id, status: data.status === 'active' ? 'disabled' : 'active' })
            }
          >
            {data.status === 'active' ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rotate.isPending}
            data-testid="rotate-secret"
            onClick={() => rotate.mutate({ id, gracePeriodHours: 24 })}
          >
            Rotate secret
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={test.isPending}
            data-testid="test-endpoint"
            onClick={() => test.mutate({ id })}
          >
            {test.isPending ? 'Testing…' : 'Test send'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            data-testid="delete-endpoint"
            onClick={() => {
              if (
                window.confirm(
                  'Delete this endpoint? Deliveries are kept but no new ones are created.',
                )
              ) {
                remove.mutate({ id });
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm text-destructive" data-testid="endpoint-action-error">
          {actionError.message}
        </p>
      ) : null}
      {testResult ? (
        <p className="text-sm" data-testid="endpoint-test-result">
          Test send: <Badge variant="secondary">{testResult}</Badge>
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Timeout">{data.timeoutMs} ms</Row>
            <Row label="Max attempts">{data.maxAttempts}</Row>
            <Row label="Rate limit">{data.rateLimitPerSecond}/s</Row>
            <Row label="Event filters">
              {data.eventTypes.length > 0 ? data.eventTypes.join(', ') : 'all events'}
            </Row>
            <Row label="Created">{formatDateTime(data.createdAt)}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Health
              {health.data ? <BreakerBadge state={health.data.state} /> : null}
            </CardTitle>
            <CardDescription>Circuit breaker and last 24 hours.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {health.isPending ? (
              <p className="text-muted-foreground">Loading health…</p>
            ) : health.isError ? (
              <p className="text-destructive">{health.error.message}</p>
            ) : health.data ? (
              <>
                <Row label="Attempts (24h)">{health.data.stats24h.attempts}</Row>
                <Row label="Succeeded / failed">
                  {health.data.stats24h.succeeded} / {health.data.stats24h.failed}
                </Row>
                <Row label="p95 latency">{formatDuration(health.data.stats24h.p95Ms)}</Row>
                <Row label="Last success">{formatDateTime(health.data.lastSuccessAt)}</Row>
                <Row label="Last failure">{formatDateTime(health.data.lastFailureAt)}</Row>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <AnimatePresence>
        {newSecret ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SecretDialog
              title="New signing secret"
              description="The old secret keeps working for the 24h grace window. This one is shown only now."
              secret={newSecret}
              testId="rotated-secret"
              onClose={() => setNewSecret(null)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}
