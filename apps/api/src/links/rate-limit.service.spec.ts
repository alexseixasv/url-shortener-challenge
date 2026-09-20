import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitService } from './rate-limit.service.js';
import { RedisService } from '../redis/redis.service.js';

describe('RateLimitService (unit)', () => {
  const prevMax = process.env.RATE_LIMIT_POST_LINKS_MAX;
  const prevWindow = process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS;

  beforeEach(() => {
    process.env.RATE_LIMIT_POST_LINKS_MAX = '3';
    process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = '60';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevMax === undefined) {
      delete process.env.RATE_LIMIT_POST_LINKS_MAX;
    } else {
      process.env.RATE_LIMIT_POST_LINKS_MAX = prevMax;
    }
    if (prevWindow === undefined) {
      delete process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS;
    } else {
      process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = prevWindow;
    }
  });

  it('allows when count <= max and denies when count > max', async () => {
    const evalFn = vi
      .fn()
      .mockResolvedValueOnce([3, 55])
      .mockResolvedValueOnce([4, 54]);
    const redis = {
      connect: vi.fn().mockResolvedValue(undefined),
      client: { eval: evalFn },
    };
    const service = new RateLimitService(redis as unknown as RedisService);

    const ok = await service.consumePostLinks('1.1.1.1');
    expect(ok.allowed).toBe(true);
    if (ok.allowed) {
      expect(ok.count).toBe(3);
    }

    const denied = await service.consumePostLinks('1.1.1.1');
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBe(54);
    }
  });

  it('fail-open when Redis throws', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = {
      connect: vi.fn().mockResolvedValue(undefined),
      client: {
        eval: vi.fn().mockRejectedValue(new Error('redis down')),
      },
    };
    const service = new RateLimitService(redis as unknown as RedisService);
    const result = await service.consumePostLinks('2.2.2.2');
    expect(result.allowed).toBe(true);
  });
});
