import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestApp } from './create-test-app.js';
import { LinksService } from '../src/links/links.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AUTO_SLUG_MAX_ATTEMPTS } from '../src/links/slug.util.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('POST /links (e2e)', () => {
  let app: INestApplication<App>;
  let linksService: LinksService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    linksService = created.moduleFixture.get(LinksService);
    prisma = created.moduleFixture.get(PrismaService);
  });

  afterEach(async () => {
    await app.close();
  });

  function uniqueSlug(prefix: string): string {
    return `${prefix}${randomBytes(4).toString('hex')}`;
  }

  it('creates with url only', async () => {
    const res = await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/e2e-min' })
      .expect(201);

    expect(res.body.slug).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(res.body.shortUrl).toBe(`http://localhost:3000/${res.body.slug}`);
    expect(res.body.url).toBe('https://example.com/e2e-min');
    expect(res.body.maxClicks).toBeNull();
    expect(res.body.expiresAt).toBeNull();
    expect(res.body).not.toHaveProperty('clickCount');
    expect(res.body).not.toHaveProperty('updatedAt');
  });

  it('creates with all fields', async () => {
    const slug = uniqueSlug('e2e');
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app.getHttpServer())
      .post('/links')
      .send({
        url: 'https://example.com/e2e-full',
        slug,
        expiresAt,
        maxClicks: 42,
      })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      slug,
      shortUrl: `http://localhost:3000/${slug}`,
      url: 'https://example.com/e2e-full',
      maxClicks: 42,
      createdAt: expect.any(String),
    });
    expect(typeof res.body.maxClicks).toBe('number');
    expect(Date.parse(res.body.expiresAt)).toBe(Date.parse(expiresAt));
  });

  it('rejects explicit null optional fields', async () => {
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', expiresAt: null })
      .expect(400);

    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', maxClicks: null })
      .expect(400);
  });

  it('rejects invalid url and unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'ftp://example.com' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', extra: true })
      .expect(400);
  });

  it('rejects invalid slug and reserved links', async () => {
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', slug: 'bad-slug' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', slug: 'links' })
      .expect(400);
  });

  it('returns 409 for duplicate custom slug', async () => {
    const slug = uniqueSlug('e2edup');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/1', slug })
      .expect(201);

    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/2', slug })
      .expect(409);
  });

  it('rejects past expiresAt and invalid maxClicks', async () => {
    await request(app.getHttpServer())
      .post('/links')
      .send({
        url: 'https://example.com',
        expiresAt: '2020-01-01T00:00:00.000Z',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', maxClicks: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', maxClicks: -1 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com', maxClicks: 1.5 })
      .expect(400);
  });

  it('returns 503 when auto slug retries are exhausted', async () => {
    const colliding = uniqueSlug('e2e503');
    await prisma.link.create({
      data: {
        slug: colliding,
        destinationUrl: 'https://example.com/seed-503',
      },
    });

    let attempts = 0;
    // Minimal test hook already on LinksService (field override) — no DI redesign.
    // Request still goes through HTTP; we only force every generated candidate to collide.
    linksService.slugGenerator = () => {
      attempts += 1;
      return colliding;
    };

    const res = await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/e2e-503' })
      .expect(503);

    expect(attempts).toBe(AUTO_SLUG_MAX_ATTEMPTS);
    expect(AUTO_SLUG_MAX_ATTEMPTS).toBe(5);

    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toMatch(/Prisma|P2002|PostgreSQL|postgres/i);
    expect(res.body.message).toBeDefined();

    const orphanCount = await prisma.link.count({
      where: { destinationUrl: 'https://example.com/e2e-503' },
    });
    expect(orphanCount).toBe(0);
  });
});
