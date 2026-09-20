import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import {
  getPostLinksRateLimitConfig,
  postLinksRateLimitKey,
} from './rate-limit.config.js';

/**
 * Fixed-window rate limit for POST /links.
 * Single Redis round-trip: INCR, EXPIRE on first hit, return {count, ttl}.
 */
const CONSUME_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return {n, ttl}
`;

export type ConsumeResult =
  | { allowed: true; count: number; ttlSeconds: number }
  | {
      allowed: false;
      count: number;
      ttlSeconds: number;
      retryAfterSeconds: number;
    };

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Fail-open: Redis errors allow the request (log + allowed).
   */
  async consumePostLinks(ip: string): Promise<ConsumeResult> {
    const { max, windowSeconds } = getPostLinksRateLimitConfig();
    const key = postLinksRateLimitKey(ip);

    try {
      await this.redis.connect();
      const raw = (await this.redis.client.eval(
        CONSUME_LUA,
        1,
        key,
        String(windowSeconds),
      )) as [number, number];

      const count = Number(raw[0]);
      let ttlSeconds = Number(raw[1]);
      // TTL -1 (no expire) / -2 (missing) should not happen after INCR+EXPIRE;
      // fall back to full window for Retry-After.
      if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
        ttlSeconds = windowSeconds;
      }

      if (count > max) {
        return {
          allowed: false,
          count,
          ttlSeconds,
          retryAfterSeconds: Math.max(1, ttlSeconds),
        };
      }

      return { allowed: true, count, ttlSeconds };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        JSON.stringify({
          msg: 'rate_limit_unavailable',
          ip,
          error: message,
        }),
      );
      return { allowed: true, count: 0, ttlSeconds: windowSeconds };
    }
  }
}
