import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { RedisService } from '../redis/redis.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { postLinksRateLimitKey } from './rate-limit.config.js';

const hasRedis = Boolean(process.env.REDIS_URL);

describe.runIf(hasRedis)('RateLimitService (integration Redis)', () => {
  let redis: RedisService;
  let service: RateLimitService;
  const prevMax = process.env.RATE_LIMIT_POST_LINKS_MAX;
  const prevWindow = process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS;

  beforeAll(async () => {
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const moduleRef = await Test.createTestingModule({
      providers: [RedisService, RateLimitService],
    }).compile();
    redis = moduleRef.get(RedisService);
    service = moduleRef.get(RateLimitService);
    await redis.connect();
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  beforeEach(() => {
    process.env.RATE_LIMIT_POST_LINKS_MAX = '5';
    process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = '30';
  });

  afterEach(async () => {
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

  function uniqueIp(): string {
    return `203.0.113.${randomBytes(1)[0]}`;
  }

  async function flushKey(ip: string): Promise<void> {
    await redis.client.del(postLinksRateLimitKey(ip));
  }

  it('sets TTL on first hit and does not extend window on subsequent incr', async () => {
    const ip = uniqueIp();
    await flushKey(ip);

    const first = await service.consumePostLinks(ip);
    expect(first.allowed).toBe(true);
    const ttl1 = await redis.client.ttl(postLinksRateLimitKey(ip));
    expect(ttl1).toBeGreaterThan(0);
    expect(ttl1).toBeLessThanOrEqual(30);

    await new Promise((r) => setTimeout(r, 1100));
    const second = await service.consumePostLinks(ip);
    expect(second.allowed).toBe(true);
    const ttl2 = await redis.client.ttl(postLinksRateLimitKey(ip));
    expect(ttl2).toBeLessThan(ttl1);
  });

  it('allows exactly MAX then denies; independent IPs', async () => {
    const ipA = uniqueIp();
    const ipB = uniqueIp();
    await flushKey(ipA);
    await flushKey(ipB);

    for (let i = 0; i < 5; i++) {
      expect((await service.consumePostLinks(ipA)).allowed).toBe(true);
    }
    const denied = await service.consumePostLinks(ipA);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    }

    expect((await service.consumePostLinks(ipB)).allowed).toBe(true);
  });

  it('concurrent consumes never exceed MAX allows', async () => {
    const ip = uniqueIp();
    await flushKey(ip);
    process.env.RATE_LIMIT_POST_LINKS_MAX = '5';

    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.consumePostLinks(ip)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(5);
  });

  it('resets after window expires', async () => {
    const ip = uniqueIp();
    await flushKey(ip);
    process.env.RATE_LIMIT_POST_LINKS_MAX = '1';
    process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = '1';

    expect((await service.consumePostLinks(ip)).allowed).toBe(true);
    expect((await service.consumePostLinks(ip)).allowed).toBe(false);

    await vi.waitFor(
      async () => {
        expect(await redis.client.exists(postLinksRateLimitKey(ip))).toBe(0);
      },
      { timeout: 4000, interval: 100 },
    );

    expect((await service.consumePostLinks(ip)).allowed).toBe(true);
  });
});
