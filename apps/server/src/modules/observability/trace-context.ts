import { context, propagation, trace, type Span, type SpanOptions } from '@opentelemetry/api';

/**
 * Manual W3C trace-context carriers for the queue boundary (the BullMQ
 * auto-instrumentation does not link producer and consumer): the API side
 * serializes the active span's context into job data; the worker extracts it
 * and continues the same trace for the attempt and the outbound HTTP call.
 */
export function serializeTraceContext(): string {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return JSON.stringify(carrier);
}

export function traceContextFromJob(raw: unknown): ReturnType<typeof context.active> {
  if (typeof raw !== 'string' || raw === '') return context.active();
  try {
    const carrier = JSON.parse(raw) as Record<string, string>;
    return propagation.extract(context.active(), carrier);
  } catch {
    return context.active();
  }
}

/** Runs `fn` in a span continued from a serialized queue context. */
export async function withContinuedTrace<T>(
  traceContext: unknown,
  name: string,
  attributes: Record<string, string | number>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const options: SpanOptions = { attributes };
  return context.with(traceContextFromJob(traceContext), async () => {
    const tracer = trace.getTracer('hookline.worker');
    const span = tracer.startSpan(name, options);
    try {
      return await context.with(trace.setSpan(context.active(), span), () => fn(span));
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}
