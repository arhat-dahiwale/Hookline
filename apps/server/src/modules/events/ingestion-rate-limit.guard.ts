import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { rateLimited } from '../platform/errors/app-error.js';
import { TokenBucketRateLimiter } from '../platform/rate-limiter/token-bucket.js';
import type { ApiKeyRequest } from '../api-keys/index.js';

/** Per-key ingestion limits (FR-16). Tunable values; documented in API.md. */
export const INGESTION_RATE_PER_SECOND = 50;
export const INGESTION_BURST_CAPACITY = 100;

/**
 * Token-bucket rate limit on `POST /v1/events`, keyed by API key. Sets the
 * RateLimit-* headers on every response (API.md 1.1) and throws the standard
 * 429 with Retry-After when exhausted. Must run after ApiKeyGuard.
 */
@Injectable()
export class IngestionRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimiter: TokenBucketRateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const apiKeyId = request.apiKeyContext?.apiKeyId;
    if (!apiKeyId) return true; // ApiKeyGuard runs first

    const result = await this.rateLimiter.take(`hl:rl:ingest:${apiKeyId}`, {
      ratePerSecond: INGESTION_RATE_PER_SECOND,
      capacity: INGESTION_BURST_CAPACITY,
    });

    reply.header('RateLimit-Limit', INGESTION_BURST_CAPACITY);
    reply.header('RateLimit-Remaining', Math.max(0, result.remaining));
    reply.header('RateLimit-Reset', Math.max(0, Math.ceil(result.retryAfterMs / 1000)));

    if (!result.allowed) {
      reply.header('Retry-After', Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
      throw rateLimited('ingestion rate limit exceeded');
    }
    return true;
  }
}
