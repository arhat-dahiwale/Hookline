import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ZodError } from 'zod';

import type { ErrorDetail } from './app-error.js';
import { AppError } from './app-error.js';
import { buildErrorBody } from './error-body.js';
import { codeForStatus } from './error-codes.js';
import { getCurrentRequestContext } from '../logger/request-context.js';
// Value import (not `import type`): Nest DI needs the class reference in
// constructor param metadata.
import { PinoLoggerService } from '../logger/pino-logger.service.js';

interface HttpLikeError {
  statusCode?: number;
  status?: number;
  message?: string;
}

function hasStatusCode(value: unknown): value is HttpLikeError {
  return (
    typeof value === 'object' && value !== null && ('statusCode' in value || 'status' in value)
  );
}

/**
 * Maps every exception leaving the app to the standard error format
 * (API.md 1.2). Stack traces and internals never reach responses.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId =
      getCurrentRequestContext()?.requestId ??
      (typeof request?.id === 'string' ? request.id : 'req_unknown');

    let status: number;
    let code: ReturnType<typeof codeForStatus>;
    let message: string;
    let details: ErrorDetail[] | undefined;

    if (exception instanceof AppError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      status = 400;
      code = 'validation_error';
      message = 'request validation failed';
      details = exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForStatus(status);
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response &&
        typeof response.message === 'string'
      ) {
        message = response.message;
      } else {
        message = exception.message;
      }
    } else if (hasStatusCode(exception)) {
      // Fastify-level errors (e.g. FST_ERR_CTP_BODY_TOO_LARGE) never carry
      // internals in `message`; map by status only.
      status = exception.statusCode ?? exception.status ?? 500;
      code = codeForStatus(status);
      message = exception.message ?? 'request failed';
    } else {
      status = 500;
      code = 'internal_error';
      message = 'internal error';
      this.logger.error(
        `unhandled exception on ${request?.method ?? '?'} ${request?.url ?? '?'}: ${
          exception instanceof Error ? exception.stack : String(exception)
        }`,
        'AllExceptionsFilter',
      );
    }

    if (status >= 500 && !(exception instanceof AppError)) {
      // Keep a trace of unexpected 5xx causes at error level without leaking
      // them into the response.
      this.logger.error(
        `exception ${code} on ${request?.method ?? '?'} ${request?.url ?? '?'}`,
        'AllExceptionsFilter',
      );
    }

    reply.status(status).send(buildErrorBody(code, message, requestId, details));
  }
}
