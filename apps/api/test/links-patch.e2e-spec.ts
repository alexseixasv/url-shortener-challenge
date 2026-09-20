import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestApp } from './create-test-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { LinkCacheService } from '../src/redirect/link-cache.service.js';
import { RedisService } from '../src/redis/redis.service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRedis = Boolean(process.env.REDIS_URL);

describe.runIf(hasDatabase && hasRedis)('PATCH /links/:slug (e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let cache: LinkCacheService;
  let redis: RedisService;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    prisma = created.moduleFixture.get(PrismaService);
    cache = created.moduleFixture.get(LinkCacheService);
    redis = created.moduleFixture.get(RedisService);
    await redis.connect();
  });

  afterEach(async () => {
    await app.close();
  });

  function uniqueSlug(prefix: string): string {
    return `${prefix}${randomBytes(4).toString('hex')}`;
  }

  it('unlimited: warm cache → PATCH 204 → GET 410; stale key gone', async () => {
    const slug = uniqueSlug('e2eu');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/e2e-unlim', slug })
      .expect(201);

    await request(app.getHttpServer()).get(`/${slug}`).expect(302);
    expect((await cache.get(slug))?.active).toBe(true);

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false })
      .expect(204);

    expect(await redis.client.get(cache.key(slug))).toBeNull();
    await request(app.getHttpServer()).get(`/${slug}`).expect(410);
    expect(
      (await prisma.link.findUniqueOrThrow({ where: { slug } })).active,
    ).toBe(false);
  });

  it('capped: PATCH 204 → GET 410', async () => {
    const slug = uniqueSlug('e2ec');
    await request(app.getHttpServer())
      .post('/links')
      .send({
        url: 'https://example.com/e2e-cap',
        slug,
        maxClicks: 10,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false })
      .expect(204);

    await request(app.getHttpServer()).get(`/${slug}`).expect(410);
  });

  it('404 / 400 validation / idempotent second PATCH', async () => {
    await request(app.getHttpServer())
      .patch(`/links/${uniqueSlug('no')}`)
      .send({ active: false })
      .expect(404);

    const slug = uniqueSlug('val');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/val', slug })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: true })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false, url: 'https://evil.com' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false })
      .expect(204);

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false })
      .expect(204);

    await request(app.getHttpServer()).get(`/${slug}`).expect(410);
  });

  it('Redis unavailable on DEL → 503; PG stays false; retry → 204 → GET 410', async () => {
    const slug = uniqueSlug('e2e503');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/503', slug })
      .expect(201);

    await request(app.getHttpServer()).get(`/${slug}`).expect(302);

    const delSpy = vi
      .spyOn(cache, 'delete')
      .mockRejectedValueOnce(new Error('redis down'));

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false })
      .expect(503);

    expect(
      (await prisma.link.findUniqueOrThrow({ where: { slug } })).active,
    ).toBe(false);

    delSpy.mockRestore();

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false })
      .expect(204);

    expect(await redis.client.get(cache.key(slug))).toBeNull();
    await request(app.getHttpServer()).get(`/${slug}`).expect(410);
  });

  it('POST /links response contract unchanged (no active field)', async () => {
    const res = await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/contract' })
      .expect(201);

    expect(res.body).not.toHaveProperty('active');
    expect(res.body).toMatchObject({
      slug: expect.any(String),
      shortUrl: expect.any(String),
      url: 'https://example.com/contract',
    });
  });
});
