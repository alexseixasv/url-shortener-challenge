import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestApp } from './create-test-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { LINK_LIST_LIMIT } from '../src/links/links.service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRedis = Boolean(process.env.REDIS_URL);

describe.runIf(hasDatabase && hasRedis)('GET /links (e2e)', () => {
  let app: INestApplication<Server>;
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

  it('retorna items array; 1 link com contrato correto', async () => {
    await prisma.$executeRaw`
      UPDATE links
      SET "clickCount" = 0
      WHERE "clickCount" > ${BigInt(Number.MAX_SAFE_INTEGER)}
    `;
    const slug = uniqueSlug('e2el');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/list-e2e', slug })
      .expect(201);

    // Ensure visibility inside LIMIT 50 window
    await prisma.link.update({
      where: { slug },
      data: { createdAt: new Date(Date.UTC(2098, 6, 1)) },
    });

    const res = await request(app.getHttpServer()).get('/links').expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    const item = res.body.items.find(
      (row: { slug: string }) => row.slug === slug,
    );
    expect(item).toMatchObject({
      slug,
      shortUrl: `http://localhost:3000/${slug}`,
      url: 'https://example.com/list-e2e',
      active: true,
      expiresAt: null,
      maxClicks: null,
      clickCount: 0,
    });
    expect(item).toHaveProperty('createdAt');
    expect(item).not.toHaveProperty('id');
  });

  it('ordem createdAt DESC e LIMIT 50; stats/patch routes intactas', async () => {
    const cutoff = new Date('2090-01-01T00:00:00.000Z');
    await prisma.accessEvent.deleteMany({
      where: { link: { createdAt: { gte: cutoff } } },
    });
    await prisma.dailyLinkStat.deleteMany({
      where: { link: { createdAt: { gte: cutoff } } },
    });
    await prisma.link.deleteMany({
      where: { createdAt: { gte: cutoff } },
    });

    const run = randomBytes(3).toString('hex');
    const prefix = `e2eb${run}`;
    const base = Date.UTC(2098, 8, 1, 12, 0, 0);
    await prisma.link.createMany({
      data: Array.from({ length: LINK_LIST_LIMIT + 3 }, (_, i) => ({
        slug: `${prefix}${String(i).padStart(3, '0')}`,
        destinationUrl: `https://example.com/e2e/${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    });

    try {
      const res = await request(app.getHttpServer()).get('/links').expect(200);
      expect(res.body.items).toHaveLength(LINK_LIST_LIMIT);
      expect(res.body.items[0].slug).toBe(
        `${prefix}${String(LINK_LIST_LIMIT + 2).padStart(3, '0')}`,
      );

      const newest = res.body.items[0].slug as string;
      await request(app.getHttpServer())
        .get(`/links/${newest}/stats`)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/links/${newest}`)
        .send({ active: false })
        .expect(204);
    } finally {
      await prisma.link.deleteMany({
        where: { slug: { startsWith: prefix } },
      });
    }
  });
});
