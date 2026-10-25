import { Inject, Injectable, type LoggerService } from '@nestjs/common';

import pino from 'pino';

import { context, trace } from '@opentelemetry/api';

import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { getCurrentRequestContext } from './request-context.js';

/** Fields that must never reach logs (AGENTS.md hard rule). */
const REDACT_PATHS = [
  'authorization',
  'secret',
  'secret_encrypted',
  '*.authorization',
  '*.secret',
  '*.secret_encrypted',
  '*.password',
  '*.key_hash',
  '*.cookies',
];

/**
 * Nest LoggerService backed by Pino. Emits JSON with level from config and
 * the current request context mixed in. Use `child()` for module-scoped
 * structured bindings (e.g. { module: 'delivery-engine' }).
 */
@Injectable()
export class PinoLoggerService implements LoggerService {
  private readonly logger: pino.Logger;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'LOG_LEVEL'>) {
    this.logger = pino({
      level: config.LOG_LEVEL,
      mixin: () => ({
        ...(getCurrentRequestContext() ?? {}),
        // Log correlation (ARCHITECTURE.md 7.3): the active span's ids on
        // every line, so dashboard logs join traces.
        ...(() => {
          const span = trace.getSpan(context.active());
          if (!span) return {};
          const { traceId, spanId, traceFlags } = span.spanContext();
          return { traceId, spanId, traceFlags };
        })(),
      }),
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      base: undefined,
    });
  }

  /** Structured child logger for a subsystem. */
  child(bindings: Record<string, unknown>): pino.Logger {
    return this.logger.child(bindings);
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  error(message: unknown, context?: string): void {
    this.write('error', message, context);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  private write(level: pino.Level, message: unknown, context?: string): void {
    const record: Record<string, unknown> = {};
    if (context !== undefined) record.context = context;
    if (message instanceof Error) {
      record.err = message;
      this.logger[level](record, message.message);
      return;
    }
    if (typeof message === 'object' && message !== null) {
      this.logger[level]({ ...record, ...(message as Record<string, unknown>) });
      return;
    }
    this.logger[level](record, String(message));
  }
}
