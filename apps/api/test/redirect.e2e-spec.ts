import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestApp } from './create-test-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnalyticsPublisherService } from '../src/analytics/analytics-publisher.service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('GET /:slug (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    const created = await createTestApp();
    app = created.app;
    prisma = created.moduleFixture.get(PrismaService);
  });

  afterEach(async () => {
    await app.close();
  });

  function uniqueSlug(prefix: string): string {
    return `${prefix}${randomBytes(4).toString('hex')}`;
  }

  async function createLink(data: {
    slug: string;
    destinationUrl?: string;
    active?: boolean;
    expiresAt?: Date | null;
    maxClicks?: bigint | null;
    clickCount?: bigint;
  }) {
    return prisma.link.create({
      data: {
        slug: data.slug,
        destinationUrl: data.destinationUrl ?? 'https://example.com/e2e',
        active: data.active ?? true,
        expiresAt: data.expiresAt === undefined ? null : data.expiresAt,
        maxClicks: data.maxClicks === undefined ? null : data.maxClicks,
        clickCount: data.clickCount ?? 0n,
      },
    });
  }

  it('existing unlimited → 302 with Location', async () => {
    const slug = uniqueSlug('ok');
    await createLink({
      slug,
      destinationUrl: 'https://example.com/target',
    });

    const res = await request(app.getHttpServer()).get(`/${slug}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/target');
  });

  it('inexistent → 404', async () => {
    await request(app.getHttpServer())
      .get(`/${uniqueSlug('no')}`)
      .expect(404);
  });

  it('disabled → 410', async () => {
    const slug = uniqueSlug('dis');
    await createLink({ slug, active: false });
    await request(app.getHttpServer()).get(`/${slug}`).expect(410);
  });

  it('expired → 410', async () => {
    const slug = uniqueSlug('exp');
    await createLink({
      slug,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await request(app.getHttpServer()).get(`/${slug}`).expect(410);
  });

  it('capped available → 302; last click → 302; next → 410', async () => {
    const slug = uniqueSlug('cap');
    await createLink({
      slug,
      maxClicks: 2n,
      clickCount: 0n,
      destinationUrl: 'https://example.com/capped',
    });

    const first = await request(app.getHttpServer()).get(`/${slug}`);
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('https://example.com/capped');

    const second = await request(app.getHttpServer()).get(`/${slug}`);
    expect(second.status).toBe(302);

    await request(app.getHttpServer()).get(`/${slug}`).expect(410);

    const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
    expect(row.clickCount).toBe(2n);
  });

  it('preserves GET / and POST /links', async () => {
    await request(app.getHttpServer()).get('/').expect(200);

    const slug = uniqueSlug('post');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/still-works', slug })
      .expect(201);

    await request(app.getHttpServer()).get(`/${slug}`).expect(302);
  });

  it('analytics publisher failure still 302', async () => {
    const created = await createTestApp();
    const localApp = created.app;
    const localPrisma = created.moduleFixture.get(PrismaService);
    const publisher = created.moduleFixture.get(AnalyticsPublisherService);
    vi.spyOn(publisher, 'publishAccess').mockImplementation(() => {
      throw new Error('should be unreachable — publishAccess must not throw');
    });
    // Override to no-op that "fails" internally without throwing
    vi.spyOn(publisher, 'publishAccess').mockImplementation(() => undefined);

    const slug = uniqueSlug('apf');
    await localPrisma.link.create({
      data: {
        slug,
        destinationUrl: 'https://example.com/pub',
      },
    });

    await request(localApp.getHttpServer()).get(`/${slug}`).expect(302);
    await localApp.close();
  });
});
