'use client';

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/trpc';

/**
 * Overview placeholder (Phase 7). Charts and KPIs arrive with the stats
 * router in Phase 11; today it proves the signed-in tRPC path end to end.
 */
export default function OverviewPage() {
  const endpointsQuery = trpc.endpoints.list.useQuery(undefined, {
    refetchOnMount: 'always',
  });

  // The org switcher dispatches this after Better Auth changes the active org;
  // every org-scoped query must refetch.
  useEffect(() => {
    const refetchAll = (): void => {
      void endpointsQuery.refetch();
    };
    window.addEventListener('hookline:org-switched', refetchAll);
    return () => window.removeEventListener('hookline:org-switched', refetchAll);
  }, [endpointsQuery]);

  const endpoints = endpointsQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Placeholder dashboard — stats and charts land in Phase 11.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void endpointsQuery.refetch()}
          aria-label="Refresh overview"
        >
          <RefreshCw aria-hidden /> Refresh
        </Button>
      </div>

      {endpointsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="overview-loading">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : endpointsQuery.isError ? (
        <Card className="border-destructive/50" data-testid="overview-error">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle aria-hidden /> Could not load overview
            </CardTitle>
            <CardDescription>
              {endpointsQuery.error.message ?? 'Something went wrong.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={() => void endpointsQuery.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : endpoints.length === 0 ? (
        <Card data-testid="overview-empty">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox aria-hidden /> No endpoints yet
            </CardTitle>
            <CardDescription>
              Create your first endpoint to start receiving webhooks. Endpoint management arrives in
              Phase 8 — until then, use the REST API (see /docs on the API server).
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="overview-endpoints">
          {endpoints.map((endpoint) => (
            <Card key={endpoint.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-base">{endpoint.url}</CardTitle>
                  <Badge
                    variant={endpoint.status === 'active' ? 'success' : 'warning'}
                    data-testid={`endpoint-status-${endpoint.id}`}
                  >
                    {endpoint.status}
                  </Badge>
                </div>
                <CardDescription className="truncate">
                  {endpoint.description ?? 'No description'}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {endpoint.eventTypes.length > 0
                  ? `Filters: ${endpoint.eventTypes.join(', ')}`
                  : 'Receives all event types'}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
