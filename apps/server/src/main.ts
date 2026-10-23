import 'reflect-metadata';

import Fastify from 'fastify';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { newId } from '@hookline/shared';

import { AppModule, type Role } from './app.module.js';
import { registerBetterAuthRoutes } from './modules/auth/index.js';
import {
  loadAppConfig,
  PinoLoggerService,
  requestContextStorage,
  type AppConfig,
} from './modules/platform/index.js';

/** Body cap: requests beyond this are rejected by Fastify (413). */
const BODY_LIMIT_BYTES = 1024 * 1024;

function buildFastify() {
  const server = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    requestIdHeader: 'x-request-id',
    genReqId: () => newId('req'),
  });

  // Wrap the entire request lifecycle in the request context so every log
  // line and the exception filter see the requestId. Callback-style hook:
  // continuing via done() inside run() keeps the store active afterwards.
  server.addHook('onRequest', (request, reply, done) => {
    const context = { requestId: String(request.id) };
    requestContextStorage.run(context, done);
    reply.header('x-request-id', context.requestId);
  });

  return server;
}

function registerSignalHandlers(
  logger: PinoLoggerService,
  shutdown: () => Promise<void>,
  timeoutMs: number,
): void {
  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.warn(`received ${signal}, draining (budget ${timeoutMs}ms)`);
      const killTimer = setTimeout(() => {
        logger.fatal('shutdown budget exhausted, forcing exit');
        process.exit(1);
      }, timeoutMs);
      killTimer.unref();
      void shutdown().then(
        () => {
          clearTimeout(killTimer);
          process.exit(0);
        },
        (error: unknown) => {
          clearTimeout(killTimer);
          logger.error(`shutdown error: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        },
      );
    });
  }
}

async function bootstrapHttp(config: AppConfig, role: Role): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRole(role, config),
    new FastifyAdapter(buildFastify()),
    { bufferLogs: true },
  );
  app.useLogger(app.get(PinoLoggerService));
  app.enableShutdownHooks();
  registerBetterAuthRoutes(app);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  const logger = app.get(PinoLoggerService).child({ module: 'bootstrap' });
  logger.info({ role, port: config.PORT }, 'hookline http server listening');

  registerSignalHandlers(app.get(PinoLoggerService), () => app.close(), config.SHUTDOWN_TIMEOUT_MS);
}

async function bootstrapWorker(config: AppConfig): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRole('worker', config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLoggerService));
  app.enableShutdownHooks();
  const nestLogger = app.get(PinoLoggerService);
  nestLogger.child({ module: 'bootstrap' }).info({ role: 'worker' }, 'hookline worker started');

  registerSignalHandlers(nestLogger, () => app.close(), config.SHUTDOWN_TIMEOUT_MS);
  // Worker modules (queues, schedulers) hold open handles from Phase 5 on.
  await new Promise(() => {});
}

async function main(): Promise<void> {
  // Parse env before booting Nest so invalid config fails fast.
  const config = loadAppConfig();
  if (config.ROLE === 'worker') {
    await bootstrapWorker(config);
    return;
  }
  await bootstrapHttp(config, config.ROLE);
}

void main().catch((error: unknown) => {
  // Logger may not exist yet; write to stderr without leaking secrets.
  process.stderr.write(
    `fatal: bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
