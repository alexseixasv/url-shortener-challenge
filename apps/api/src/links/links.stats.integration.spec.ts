import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinkCacheService } from '../redirect/link-cache.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService } from './links.service.js';
import { formatUtcYmd, utcLast7DaysWindow } from './stats-window.util.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('LinksService.getStats (integration)', () => {
  let prisma: PrismaService;
  let links: LinksService;

  beforeAll(async () => {
    process.env.SHORT_URL_BASE_URL ??= 'http://localhost:3000';
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, RedisService, LinkCacheService, LinksService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    links = moduleRef.get(LinksService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function uniqueSlug(prefix: string): string {
    return `${prefix}${randomBytes(4).toString('hex')}`;
  }

  async function seedAccess(
    linkId: string,
    accessedAt: Date,
    opts?: { referer?: string | null; userAgent?: string | null },
  ) {
    await prisma.accessEvent.create({
      data: {
        eventId: randomUUID(),
        linkId,
        accessedAt,
        referer: opts?.referer === undefined ? 'https://ref.example' : opts.referer,
        userAgent:
          opts?.userAgent === undefined ? 'TestAgent/1.0' : opts.userAgent,
      },
    });
  }

  it('missing slug → NotFoundException', async () => {
    await expect(links.getStats(uniqueSlug('miss'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('link with no accesses: zeros and empty recentAccesses', async () => {
    const slug = uniqueSlug('empty');
    await links.create({ url: 'https://example.com/empty', slug });
    const stats = await links.getStats(slug);
    expect(stats.slug).toBe(slug);
    expect(stats.totalClicks).toBe(0);
    expect(stats.last7Days).toHaveLength(7);
    expect(stats.last7Days.every((d) => d.clicks === 0)).toBe(true);
    expect(stats.recentAccesses).toEqual([]);
  });

  it('last7Days: 7 UTC days ASC, zero-fill, outside the window excluded', async () => {
    const slug = uniqueSlug('sparse');
    const created = await links.create({
      url: 'https://example.com/sparse',
      slug,
    });
    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });
    const now = new Date(Date.UTC(2026, 8, 20, 15, 30, 0));
    const window = utcLast7DaysWindow(now);

    await prisma.link.update({
      where: { id: link.id },
      data: { clickCount: 42n },
    });

    // one day inside window
    const mid = window.dates[3];
    await prisma.dailyLinkStat.create({
      data: {
        linkId: link.id,
        date: new Date(`${mid}T00:00:00.000Z`),
        clickCount: 7n,
      },
    });
    // outside window (8 days ago)
    const outside = new Date(window.start);
    outside.setUTCDate(outside.getUTCDate() - 1);
    await prisma.dailyLinkStat.create({
      data: {
        linkId: link.id,
        date: outside,
        clickCount: 99n,
      },
    });

    const stats = await links.getStats(slug, now);
    expect(stats.totalClicks).toBe(42);
    expect(stats.last7Days).toHaveLength(7);
    expect(stats.last7Days.map((d) => d.date)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
    expect(stats.last7Days[3].clicks).toBe(7);
    expect(stats.last7Days.filter((d) => d.clicks === 0)).toHaveLength(6);
    expect(stats.last7Days.some((d) => d.clicks === 99)).toBe(false);
    expect(created.slug).toBe(slug);
  });

  it('totalClicks comes from Link.clickCount even when AccessEvent diverges', async () => {
    const slug = uniqueSlug('div');
    await links.create({ url: 'https://example.com/div', slug });
    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });
    await prisma.link.update({
      where: { id: link.id },
      data: { clickCount: 100n },
    });
    await seedAccess(link.id, new Date());
    await seedAccess(link.id, new Date(Date.now() - 1000));

    const stats = await links.getStats(slug);
    expect(stats.totalClicks).toBe(100);
    expect(stats.recentAccesses).toHaveLength(2);
    // eventual consistency (ADR-001): aggregates may diverge; not an error
    expect(
      stats.last7Days.reduce((sum, d) => sum + d.clicks, 0),
    ).toBe(0);
  });

  it('1 recent access; null referer/userAgent preserved', async () => {
    const slug = uniqueSlug('one');
    await links.create({ url: 'https://example.com/one', slug });
    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });
    const at = new Date('2026-09-18T12:00:00.000Z');
    await seedAccess(link.id, at, { referer: null, userAgent: null });

    const stats = await links.getStats(slug);
    expect(stats.recentAccesses).toHaveLength(1);
    expect(stats.recentAccesses[0]).toEqual({
      accessedAt: at.toISOString(),
      referer: null,
      userAgent: null,
    });
  });

  it('exactly 20 recent accesses', async () => {
    const slug = uniqueSlug('ex20');
    await links.create({ url: 'https://example.com/ex20', slug });
    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });
    const base = Date.UTC(2026, 8, 11, 0, 0, 0);
    for (let i = 0; i < 20; i++) {
      await seedAccess(link.id, new Date(base + i * 60_000), {
        referer: `e-${i}`,
      });
    }
    const stats = await links.getStats(slug);
    expect(stats.recentAccesses).toHaveLength(20);
    expect(stats.recentAccesses[0].referer).toBe('e-19');
    expect(stats.recentAccesses[19].referer).toBe('e-0');
  });

  it('more than 20 → only 20; ORDER BY accessedAt DESC', async () => {
    const slug = uniqueSlug('lim20');
    await links.create({ url: 'https://example.com/lim20', slug });
    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });

    const base = Date.UTC(2026, 8, 10, 0, 0, 0);
    for (let i = 0; i < 25; i++) {
      await seedAccess(link.id, new Date(base + i * 60_000), {
        referer: `r-${i}`,
        userAgent: `ua-${i}`,
      });
    }

    const stats = await links.getStats(slug);
    expect(stats.recentAccesses).toHaveLength(20);
    expect(stats.recentAccesses[0].referer).toBe('r-24');
    expect(stats.recentAccesses[19].referer).toBe('r-5');
    for (let i = 1; i < stats.recentAccesses.length; i++) {
      expect(
        Date.parse(stats.recentAccesses[i - 1].accessedAt),
      ).toBeGreaterThan(Date.parse(stats.recentAccesses[i].accessedAt));
    }
  });

  it('disabled / expired / maxed → stats 200 (no throw)', async () => {
    const slugDis = uniqueSlug('stdis');
    await links.create({ url: 'https://example.com/stdis', slug: slugDis });
    await prisma.link.update({
      where: { slug: slugDis },
      data: { active: false },
    });
    await expect(links.getStats(slugDis)).resolves.toMatchObject({
      slug: slugDis,
      totalClicks: 0,
    });

    const slugExp = uniqueSlug('stexp');
    await links.create({
      url: 'https://example.com/stexp',
      slug: slugExp,
    });
    await prisma.link.update({
      where: { slug: slugExp },
      data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    await expect(links.getStats(slugExp)).resolves.toMatchObject({
      slug: slugExp,
    });

    const slugMax = uniqueSlug('stmax');
    await links.create({
      url: 'https://example.com/stmax',
      slug: slugMax,
      maxClicks: 1,
    });
    const maxed = await prisma.link.findUniqueOrThrow({
      where: { slug: slugMax },
    });
    await prisma.link.update({
      where: { id: maxed.id },
      data: { clickCount: 1n },
    });
    const stats = await links.getStats(slugMax);
    expect(stats.totalClicks).toBe(1);
  });

  it('BigInt serializes; boundary > MAX_SAFE_INTEGER does not lose precision silently', async () => {
    const slugOk = uniqueSlug('bisafe');
    await links.create({ url: 'https://example.com/bisafe', slug: slugOk });
    const ok = await prisma.link.findUniqueOrThrow({ where: { slug: slugOk } });
    await prisma.link.update({
      where: { id: ok.id },
      data: { clickCount: BigInt(Number.MAX_SAFE_INTEGER) },
    });
    expect((await links.getStats(slugOk)).totalClicks).toBe(
      Number.MAX_SAFE_INTEGER,
    );

    const slugBad = uniqueSlug('biover');
    await links.create({ url: 'https://example.com/biover', slug: slugBad });
    const bad = await prisma.link.findUniqueOrThrow({
      where: { slug: slugBad },
    });
    await prisma.link.update({
      where: { id: bad.id },
      data: { clickCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
    });
    await expect(links.getStats(slugBad)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('UTC window: today UTC + 6 previous days (fixed instant via daily rows)', async () => {
    const slug = uniqueSlug('utc');
    await links.create({ url: 'https://example.com/utc', slug });
    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });
    const now = new Date(Date.UTC(2026, 0, 1, 23, 59, 59));
    const w = utcLast7DaysWindow(now);
    await prisma.dailyLinkStat.create({
      data: {
        linkId: link.id,
        date: w.end,
        clickCount: 3n,
      },
    });
    const stats = await links.getStats(slug, now);
    expect(stats.last7Days).toHaveLength(7);
    expect(stats.last7Days.map((d) => d.date)).toEqual([
      '2025-12-26',
      '2025-12-27',
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
    ]);
    expect(stats.last7Days[6].clicks).toBe(3);
    expect(stats.last7Days[0].date).toBe(formatUtcYmd(w.start));
  });
});
