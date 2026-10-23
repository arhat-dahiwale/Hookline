import { Injectable } from '@nestjs/common';

// Value import: Nest DI needs the class in constructor param metadata.
import { RedisService } from '../redis/redis.service.js';

/**
 * Continuous-refill token bucket over a Redis hash (DATA.md `hl:rl:*`).
 * Atomic via Lua; returns header values for API.md's RateLimit-* contract.
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
if tokens == nil then tokens = capacity end
local ts = tonumber(data[2])
if ts == nil then ts = now end
tokens = math.min(capacity, tokens + (now - ts) / 1000 * rate)
local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end
redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, 120000)
local reset_ms = 0
if allowed == 0 then
  reset_ms = math.ceil((requested - tokens) / rate * 1000)
end
return { allowed, math.floor(tokens), reset_ms }
`;

export interface TokenBucketResult {
  allowed: boolean;
  /** Tokens left after this request. */
  remaining: number;
  /** When denied: ms until one token is available. */
  retryAfterMs: number;
}

@Injectable()
export class TokenBucketRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async take(
    key: string,
    options: { ratePerSecond: number; capacity: number },
    requested = 1,
  ): Promise<TokenBucketResult> {
    const [allowed, remaining, retryAfterMs] = (await this.redis.client.eval(
      TOKEN_BUCKET_LUA,
      1,
      key,
      options.ratePerSecond,
      options.capacity,
      Date.now(),
      requested,
    )) as [number, number, number];
    return {
      allowed: allowed === 1,
      remaining,
      retryAfterMs,
    };
  }
}
