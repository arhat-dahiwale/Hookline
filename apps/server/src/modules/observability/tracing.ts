import { DiagConsoleLogger, diag, DiagLogLevel } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

import type { AppConfig } from '../platform/config/app-config.js';

let sdk: NodeSDK | null = null;

/**
 * OpenTelemetry SDK (ARCHITECTURE.md 7.3): auto-instruments HTTP/Fastify,
 * Postgres and Redis so one trace spans the API request, the enqueue, the
 * worker job and the outbound HTTP call. Trace context travels in job data
 * (the BullMQ span propagation is manual — see delivery queue/processor).
 *
 * Exporter: OTLP to OTEL_EXPORTER_OTLP_ENDPOINT when set; otherwise traces
 * are dropped (local dev without the observability stack stays silent —
 * no outbound calls to arbitrary hosts).
 */
export function startTracing(config: AppConfig, exporterOverride?: SpanExporter): void {
  if (sdk) return;
  const exporters: SpanExporter[] = [];

  if (exporterOverride) {
    // Test hook: capture spans in-process instead of exporting.
    exporters.push(exporterOverride);
  } else if (config.OTEL_EXPORTER_OTLP_ENDPOINT !== '') {
    exporters.push(
      new OTLPTraceExporter({
        url: `${config.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/traces`,
      }),
    );
  }

  sdk = new NodeSDK({
    serviceName: config.OTEL_SERVICE_NAME,
    traceExporter: exporters[0],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Instrument only what the architecture calls for; skip the noisy ones.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });
  sdk.start();

  if (config.LOG_LEVEL === 'debug') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
  }
}

export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  const current = sdk;
  sdk = null;
  await current.shutdown().catch(() => undefined);
}
