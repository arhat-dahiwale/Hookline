import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Consistent loading skeleton block (every view needs this — AGENTS.md). */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <Card data-testid="view-loading">
      <CardContent className="flex items-center gap-3 p-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span aria-live="polite">{label}…</span>
      </CardContent>
    </Card>
  );
}

/**
 * True when the tRPC error is the signed-in-but-no-organization case; those
 * get a first-run block, not an error (nothing failed — nothing is set up).
 */
export function isOrgRequiredError(error: { message?: string } | null | undefined): boolean {
  return error?.message === 'no active organization';
}

/** Empty state with optional call to action. */
export function EmptyBlock({
  title,
  description,
  action,
  testId,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId ?? 'view-empty'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox aria-hidden /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        {action}
      </CardContent>
    </Card>
  );
}

/** Error state with retry. */
export function ErrorBlock({
  title,
  error,
  onRetry,
  testId,
}: {
  title: string;
  error: { message?: string } | null;
  onRetry: () => void;
  testId?: string;
}) {
  return (
    <Card className="border-destructive/50" data-testid={testId ?? 'view-error'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle aria-hidden /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{error?.message ?? 'Something went wrong.'}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
