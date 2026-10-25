import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  type CounterConfiguration,
  type GaugeConfiguration,
  type HistogramConfiguration,
} from 'prom-client';

import { APP_CONFIG, type AppConfig } from '../platform/config/app-config.js';
import { RedisService } from '../platform/redis/redis.service.js';

export type MetricLabels = Record<string, string | undefined>;

/**
 * Prometheus registry (ARCHITECTURE.md 7.3). Labels are strictly
 * low-cardinality: routes are templated, never raw paths; org/endpoint ids
 * NEVER become labels.
 */
@Injectable()
export class MetricsService implements OnApplicationShutdown {
  readonly registry: Registry;

  readonly httpRequestDuration: Histogram<string>;
  readonly eventsIngested: Counter<string>;
  readonly deliveriesCreated: Counter<string>;
  readonly deliveryAttempts: Counter<string>;
  readonly deliveryAttemptDuration: Histogram<string>;
  readonly deliveryDispatchLag: Histogram<string>;
  readonly deliveriesDead: Counter<string>;
  readonly queueDepth: Gauge<string>;
  readonly breakerTransitions: Counter<string>;
  readonly rateLimited: Counter<string>;
  readonly wsConnections: Gauge<string>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: this.config.OTEL_SERVICE_NAME });
    collectDefaultMetrics({ register: this.registry });

    const histogramConfig = (
      name: string,
      help: string,
      labelNames: string[],
      buckets: number[],
    ): HistogramConfiguration<string> => ({
      name,
      help,
      labelNames,
      buckets,
      registers: [this.registry],
    });
    const counterConfig = (
      name: string,
      help: string,
      labelNames: string[] = [],
    ): CounterConfiguration<string> => ({ name, help, labelNames, registers: [this.registry] });
    const gaugeConfig = (
      name: string,
      help: string,
      labelNames: string[] = [],
    ): GaugeConfiguration<string> => ({ name, help, labelNames, registers: [this.registry] });

    this.httpRequestDuration = new Histogram(
      histogramConfig(
        'hookline_http_request_duration_seconds',
        'HTTP request duration by templated route',
        ['route', 'method', 'status'],
        [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      ),
    );
    this.eventsIngested = new Counter(
      counterConfig('hookline_events_ingested_total', 'Events accepted'),
    );
    this.deliveriesCreated = new Counter(
      counterConfig('hookline_deliveries_created_total', 'Deliveries fanned out'),
    );
    this.deliveryAttempts = new Counter(
      counterConfig('hookline_delivery_attempts_total', 'Delivery attempts by outcome', [
        'outcome',
      ]),
    );
    this.deliveryAttemptDuration = new Histogram(
      histogramConfig(
        'hookline_delivery_attempt_duration_seconds',
        'Outbound HTTP attempt duration',
        [],
        [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      ),
    );
    this.deliveryDispatchLag = new Histogram(
      histogramConfig(
        'hookline_delivery_dispatch_lag_seconds',
        'Seconds between the scheduled attempt time and the attempt start',
        [],
        [0.05, 0.1, 0.25, 0.5, 1, 5, 15, 60, 300],
      ),
    );
    this.deliveriesDead = new Counter(
      counterConfig('hookline_deliveries_dead_total', 'Deliveries moved to dead'),
    );
    this.breakerTransitions = new Counter(
      counterConfig('hookline_circuit_breaker_transitions_total', 'Breaker state transitions', [
        'to',
      ]),
    );
    this.rateLimited = new Counter(
      counterConfig('hookline_rate_limited_total', 'Rate limit denials', ['scope']),
    );
    this.wsConnections = new Gauge(
      gaugeConfig('hookline_ws_connections', 'Live WebSocket connections'),
    );

    // Queue depth is sampled at scrape time from BullMQ's Redis structures
    // (pull model) — states read straight from the known keys.
    this.queueDepth = new Gauge({
      name: 'hookline_queue_depth',
      help: 'BullMQ job counts',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
      collect: async () => {
        const client = this.redis.client;
        const states: [string, Promise<number>][] = [
          ['waiting', client.llen('hl:bull:delivery:wait')],
          ['active', client.scard('hl:bull:delivery:active')],
          ['delayed', client.zcard('hl:bull:delivery:delayed')],
          ['failed', client.zcard('hl:bull:delivery:failed')],
        ];
        for (const [state, promise] of states) {
          try {
            this.queueDepth.set({ queue: 'delivery', state }, await promise);
          } catch {
            // a scrape must never fail because of the gauge
          }
        }
      },
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  onApplicationShutdown(): void {
    this.registry.clear();
  }
}
