import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestApp } from './create-test-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RateLimitService } from '../src/links/rate-limit.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { postLinksRateLimitKey } from '../src/links/rate-limit.config.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRedis = Boolean(process.env.REDIS_URL);

function uniqueClientIp(): string {
  // TEST-NET (RFC 5737) — unique per test when TRUST_PROXY is on
  return `198.51.100.${1 + (randomBytes(1)[0] % 200)}`;
}

describe.runIf(hasDatabase && hasRedis)('POST /links rate limit (e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let redis: RedisService;
  let clientIp: string;

  const prevMax = process.env.RATE_LIMIT_POST_LINKS_MAX;
  const prevWindow = process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS;
  const prevTrust = process.env.TRUST_PROXY;

  beforeEach(async () => {
    process.env.RATE_LIMIT_POST_LINKS_MAX = '3';
    process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = '60';
    process.env.TRUST_PROXY = '1';
    clientIp = uniqueClientIp();
    const created = await createTestApp();
    app = created.app;
    prisma = created.moduleFixture.get(PrismaService);
    redis = created.moduleFixture.get(RedisService);
    await redis.connect();
    await redis.client.del(postLinksRateLimitKey(clientIp));
  });

  afterEach(async () => {
    await app.close();
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
    if (prevTrust === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = prevTrust;
    }
  });

  function uniqueSlug(prefix: string): string {
    return `${prefix}${randomBytes(4).toString('hex')}`;
  }

  function postLinks(body: object) {
    return request(app.getHttpServer())
      .post('/links')
      .set('X-Forwarded-For', clientIp)
      .send(body);
  }

  it('allows up to MAX then returns 429 with Retry-After and does not persist', async () => {
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const slug = uniqueSlug(`rl${i}`);
      slugs.push(slug);
      await postLinks({ url: 'https://example.com/rl', slug }).expect(201);
    }

    expect(
      await prisma.link.count({ where: { slug: { in: slugs } } }),
    ).toBe(3);

    const blockedSlug = uniqueSlug('rlx');
    const denied = await postLinks({
      url: 'https://example.com/blocked',
      slug: blockedSlug,
    }).expect(429);

    expect(denied.body).toMatchObject({
      statusCode: 429,
      message: 'rate limit exceeded',
    });
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(
      await prisma.link.findUnique({ where: { slug: blockedSlug } }),
    ).toBeNull();
  });

  it('GET /:slug is not rate limited after POST quota exhausted', async () => {
    const slug = uniqueSlug('getok');
    await postLinks({
      url: 'https://example.com/get-ok',
      slug,
    }).expect(201);

    for (let i = 0; i < 2; i++) {
      await postLinks({
        url: 'https://example.com/fill',
        slug: uniqueSlug('fill'),
      }).expect(201);
    }
    await postLinks({
      url: 'https://example.com/over',
      slug: uniqueSlug('over'),
    }).expect(429);

    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer()).get(`/${slug}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://example.com/get-ok');
    }
  });

  it('fail-open path allows create when consume allows', async () => {
    const rateLimit = app.get(RateLimitService);
    const spy = vi
      .spyOn(rateLimit, 'consumePostLinks')
      .mockResolvedValue({
        allowed: true,
        count: 0,
        ttlSeconds: 60,
      });

    const slug = uniqueSlug('fo');
    await postLinks({
      url: 'https://example.com/fail-open',
      slug,
    }).expect(201);

    expect(await prisma.link.findUnique({ where: { slug } })).not.toBeNull();
    spy.mockRestore();
  });
});

describe.runIf(hasDatabase && hasRedis)(
  'POST /links rate limit concurrency (e2e)',
  () => {
    let app: INestApplication<Server>;
    let redis: RedisService;
    let clientIp: string;
    const prevMax = process.env.RATE_LIMIT_POST_LINKS_MAX;
    const prevTrust = process.env.TRUST_PROXY;

    beforeEach(async () => {
      process.env.RATE_LIMIT_POST_LINKS_MAX = '5';
      process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = '120';
      process.env.TRUST_PROXY = '1';
      clientIp = uniqueClientIp();
      const created = await createTestApp();
      app = created.app;
      redis = created.moduleFixture.get(RedisService);
      await redis.connect();
      await redis.client.del(postLinksRateLimitKey(clientIp));
    });

    afterEach(async () => {
      await app.close();
      if (prevMax === undefined) {
        delete process.env.RATE_LIMIT_POST_LINKS_MAX;
      } else {
        process.env.RATE_LIMIT_POST_LINKS_MAX = prevMax;
      }
      if (prevTrust === undefined) {
        delete process.env.TRUST_PROXY;
      } else {
        process.env.TRUST_PROXY = prevTrust;
      }
    });

    it('parallel POSTs from same client never exceed MAX 201s', async () => {
      const server = app.getHttpServer();
      const results = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          request(server)
            .post('/links')
            .set('X-Forwarded-For', clientIp)
            .send({
              url: `https://example.com/c${i}`,
              slug: `c${randomBytes(4).toString('hex')}`,
            }),
        ),
      );
      const created = results.filter((r) => r.status === 201).length;
      const limited = results.filter((r) => r.status === 429).length;
      expect(created).toBe(5);
      expect(limited).toBe(10);
    });
  },
);
