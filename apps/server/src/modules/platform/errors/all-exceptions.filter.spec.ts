import { HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { z } from 'zod';

import { PinoLoggerService } from '../logger/pino-logger.service.js';
import { AppError } from './app-error.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function makeHost() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  const request = { id: 'req_test', method: 'GET', url: '/health/ready' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { reply, host };
}

function makeFilter() {
  const logger = new PinoLoggerService({ LOG_LEVEL: 'silent' });
  return { filter: new AllExceptionsFilter(logger), logger };
}

describe('AllExceptionsFilter', () => {
  it('maps AppError to its code and status', () => {
    const { filter } = makeFilter();
    const { reply, host } = makeHost();
    filter.catch(new AppError('not_found', 'no such endpoint'), host);
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: { code: 'not_found', message: 'no such endpoint', requestId: 'req_test' },
    });
  });

  it('maps ZodError to 400 validation_error with details', () => {
    const { filter } = makeFilter();
    const { reply, host } = makeHost();
    const error = z.object({ type: z.string() }).safeParse({});
    filter.catch(error.error, host);
    expect(reply.status).toHaveBeenCalledWith(400);
    const body = reply.send.mock.calls[0][0] as {
      error: { code: string; details: { path: string }[] };
    };
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details[0]?.path).toBe('type');
  });

  it('maps Nest HttpException by status', () => {
    const { filter } = makeFilter();
    const { reply, host } = makeHost();
    filter.catch(new HttpException('stale state', 409), host);
    expect(reply.status).toHaveBeenCalledWith(409);
    const body = reply.send.mock.calls[0][0] as { error: { code: string; message: string } };
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toBe('stale state');
  });

  it('maps Fastify body-too-large errors to payload_too_large', () => {
    const { filter } = makeFilter();
    const { reply, host } = makeHost();
    const fastifyError = Object.assign(new Error('Request body too large'), { statusCode: 413 });
    filter.catch(fastifyError, host);
    expect(reply.status).toHaveBeenCalledWith(413);
    const body = reply.send.mock.calls[0][0] as { error: { code: string } };
    expect(body.error.code).toBe('payload_too_large');
  });

  it('hides internals for unknown errors', () => {
    const { filter } = makeFilter();
    const { reply, host } = makeHost();
    filter.catch(new Error('secret db password is hunter2'), host);
    expect(reply.status).toHaveBeenCalledWith(500);
    const body = reply.send.mock.calls[0][0] as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('internal error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
