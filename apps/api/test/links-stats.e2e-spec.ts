import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTestApp } from './create-test-app.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { utcLast7DaysWindow } from '../src/links/stats-window.util.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRedis = Boolean(process.env.REDIS_URL);

describe.runIf(hasDatabase && hasRedis)('GET /links/:slug/stats (e2e)', () => {
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

  it('404 for a missing slug', async () => {
    await request(app.getHttpServer())
      .get(`/links/${uniqueSlug('nostats')}/stats`)
      .expect(404);
  });

  it('link with no accesses returns the full contract', async () => {
    const slug = uniqueSlug('e2es0');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/e2e-stats0', slug })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/links/${slug}/stats`)
      .expect(200);

    expect(res.body).toEqual({
      slug,
      totalClicks: 0,
      last7Days: utcLast7DaysWindow().dates.map((date) => ({
        date,
        clicks: 0,
      })),
      recentAccesses: [],
    });
  });

  it('sparse daily + recent + disabled still 200', async () => {
    const slug = uniqueSlug('e2ess');
    await request(app.getHttpServer())
      .post('/links')
      .send({ url: 'https://example.com/e2e-sparse', slug })
      .expect(201);

    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });
    const w = utcLast7DaysWindow();
    await prisma.link.update({
      where: { id: link.id },
      data: { clickCount: 5n },
    });
    await prisma.dailyLinkStat.create({
      data: {
        linkId: link.id,
        date: w.dates[1] ? new Date(`${w.dates[1]}T00:00:00.000Z`) : w.start,
        clickCount: 2n,
      },
    });
    await prisma.accessEvent.create({
      data: {
        eventId: randomUUID(),
        linkId: link.id,
        accessedAt: new Date('2026-09-19T10:00:00.000Z'),
        referer: null,
        userAgent: 'e2e-agent',
      },
    });

    await request(app.getHttpServer())
      .patch(`/links/${slug}`)
      .send({ active: false })
      .expect(204);

    const res = await request(app.getHttpServer())
      .get(`/links/${slug}/stats`)
      .expect(200);

    expect(res.body.totalClicks).toBe(5);
    expect(res.body.last7Days).toHaveLength(7);
    expect(res.body.last7Days[1].clicks).toBe(2);
    expect(res.body.recentAccesses).toHaveLength(1);
    expect(res.body.recentAccesses[0].referer).toBeNull();
    expect(res.body.recentAccesses[0].userAgent).toBe('e2e-agent');
  });

  it('expired and maxed still return stats', async () => {
    const slugExp = uniqueSlug('e2eex');
    await request(app.getHttpServer())
      .post('/links')
      .send({
        url: 'https://example.com/exp',
        slug: slugExp,
      })
      .expect(201);
    await prisma.link.update({
      where: { slug: slugExp },
      data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    await request(app.getHttpServer())
      .get(`/links/${slugExp}/stats`)
      .expect(200);

    const slugMax = uniqueSlug('e2emx');
    await request(app.getHttpServer())
      .post('/links')
      .send({
        url: 'https://example.com/max',
        slug: slugMax,
        maxClicks: 1,
      })
      .expect(201);
    const link = await prisma.link.findUniqueOrThrow({
      where: { slug: slugMax },
    });
    await prisma.link.update({
      where: { id: link.id },
      data: { clickCount: 1n },
    });
    const res = await request(app.getHttpServer())
      .get(`/links/${slugMax}/stats`)
      .expect(200);
    expect(res.body.totalClicks).toBe(1);
  });
});
