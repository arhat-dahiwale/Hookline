'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo, useState } from 'react';

import { BreakerBadge } from '@/components/status-badge';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/view-states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { formatDuration } from '@/lib/format';
import { trpc } from '@/lib/trpc';

const RANGES: Record<string, { label: string; hours: number }> = {
  '1h': { label: 'Last hour', hours: 1 },
  '24h': { label: 'Last 24 hours', hours: 24 },
  '7d': { label: 'Last 7 days', hours: 24 * 7 },
  '30d': { label: 'Last 30 days', hours: 24 * 30 },
};

function shortTime(iso: string, rangeHours: number): string {
  const date = new Date(iso);
  return rangeHours <= 24
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
}

/**
 * Analytics (API.md stats.*): volume, success rate, latency percentiles and
 * per-endpoint health — computed from the raw tables, so always accurate for
 * the selected window.
 */
export default function AnalyticsPage() {
  const [range, setRange] = useState('24h');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const rangeHours = RANGES[range]!.hours;
  // Stable per range selection: a fresh object every render would change the
  // serialized query input and TanStack Query would never settle.
  const window = useMemo(
    () => ({ from: new Date(Date.now() - rangeHours * 3_600_000), to: new Date() }),
    [rangeHours],
  );

  const refetchInterval = autoRefresh ? 10_000 : false;
  const overview = trpc.stats.overview.useQuery(window, { refetchInterval });
  const timeseries = trpc.stats.timeseries.useQuery(window, { refetchInterval });
  const breakdown = trpc.stats.endpointBreakdown.useQuery(window, { refetchInterval });

  const loading = overview.isPending || timeseries.isPending;
  const error = overview.error ?? timeseries.error ?? breakdown.error;
  const hasData = (overview.data?.attempts ?? 0) > 0 || (overview.data?.events ?? 0) > 0;

  const volumeData = (timeseries.data ?? []).map((point) => ({
    time: shortTime(point.bucketStart, rangeHours),
    succeeded: point.succeeded,
    failed: point.failed,
  }));
  const latencyData = (timeseries.data ?? []).map((point) => ({
    time: shortTime(point.bucketStart, rangeHours),
    p50: point.latencyP50Ms,
    p95: point.latencyP95Ms,
    p99: point.latencyP99Ms,
  }));
  const statusData = overview.data
    ? [
        { name: 'succeeded', value: overview.data.succeeded },
        { name: 'failed attempts', value: overview.data.failed },
        { name: 'dead deliveries', value: overview.data.dead },
      ].filter((entry) => entry.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">Delivery health for your organization.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="auto-refresh"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              aria-label="Auto-refresh every 10 seconds"
              data-testid="auto-refresh"
            />
            <Label htmlFor="auto-refresh" className="text-xs text-muted-foreground">
              Auto-refresh
            </Label>
          </div>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40" aria-label="Time range" data-testid="time-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RANGES).map(([value, config]) => (
                <SelectItem key={value} value={value}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="Loading analytics" />
      ) : error ? (
        <ErrorBlock
          title="Could not load analytics"
          error={error}
          onRetry={() => {
            void overview.refetch();
            void timeseries.refetch();
            void breakdown.refetch();
          }}
        />
      ) : !hasData ? (
        <EmptyBlock
          title="No activity in this window"
          description="Send events through the API or the dashboard to see volume, success rate and latency charts."
          testId="analytics-empty"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="stats-overview">
            <Kpi label="Events" value={String(overview.data!.events)} />
            <Kpi label="Deliveries" value={String(overview.data!.deliveries)} />
            <Kpi
              label="Success rate"
              value={
                overview.data!.successRate === null
                  ? '—'
                  : `${(overview.data!.successRate * 100).toFixed(1)}%`
              }
            />
            <Kpi label="Dead" value={String(overview.data!.dead)} />
            <Kpi label="p95 latency" value={formatDuration(overview.data!.latencyP95Ms)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Volume over time</CardTitle>
                <CardDescription>Attempts per hour by outcome.</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={volumeData} data-testid="volume-chart">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="succeeded"
                      stackId="1"
                      stroke="var(--success)"
                      fill="var(--success)"
                      fillOpacity={0.3}
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      stackId="1"
                      stroke="var(--destructive)"
                      fill="var(--destructive)"
                      fillOpacity={0.3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Latency percentiles</CardTitle>
                <CardDescription>p50 / p95 / p99 per hour (ms).</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={latencyData} data-testid="latency-chart">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="time" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="p50" stroke="var(--primary)" dot={false} />
                    <Line type="monotone" dataKey="p95" stroke="var(--warning)" dot={false} />
                    <Line type="monotone" dataKey="p99" stroke="var(--destructive)" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Outcome breakdown</CardTitle>
                <CardDescription>Attempts and terminal states in the window.</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusData} data-testid="status-chart">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="var(--primary)" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Endpoint health</CardTitle>
                <CardDescription>Breaker state and per-endpoint outcomes.</CardDescription>
              </CardHeader>
              <CardContent>
                {(breakdown.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="breakdown-empty">
                    No endpoints yet.
                  </p>
                ) : (
                  <div
                    className="max-h-64 overflow-y-auto rounded-lg border"
                    data-testid="breakdown-table"
                  >
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/60 text-left text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Endpoint</th>
                          <th className="px-3 py-2 font-medium">Breaker</th>
                          <th className="px-3 py-2 font-medium">Success</th>
                          <th className="px-3 py-2 font-medium">Dead</th>
                          <th className="px-3 py-2 font-medium">p95</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdown.data!.map((row) => (
                          <tr key={row.endpointId} className="border-t">
                            <td className="max-w-[180px] truncate px-3 py-2">{row.url}</td>
                            <td className="px-3 py-2">
                              <BreakerBadge state={row.breakerState} />
                            </td>
                            <td className="px-3 py-2">
                              {row.successRate === null
                                ? '—'
                                : `${(row.successRate * 100).toFixed(0)}%`}
                            </td>
                            <td className="px-3 py-2">{row.dead}</td>
                            <td className="px-3 py-2">{formatDuration(row.latencyP95Ms)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className="text-2xl"
          data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
