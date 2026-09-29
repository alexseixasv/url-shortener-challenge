import { InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinkCacheService } from '../redirect/link-cache.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LINK_LIST_LIMIT, LinksService } from './links.service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('LinksService.list (unit empty)', () => {
  it('empty database → items []', async () => {
    const prisma = {
      link: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LinksService,
        { provide: PrismaService, useValue: prisma },
        { provide: LinkCacheService, useValue: {} },
      ],
    }).compile();
    process.env.SHORT_URL_BASE_URL ??= 'http://localhost:3000';
    const links = moduleRef.get(LinksService);
    await expect(links.list()).resolves.toEqual({ items: [] });
  });
});

describe.runIf(hasDatabase)('LinksService.list (integration)', () => {
  let prisma: PrismaService;
  let links: LinksService;
  const runId = randomBytes(3).toString('hex');
  /** Monotonic tip so our rows stay inside the global top-50 window. */
  let tipMs = Date.UTC(2098, 0, 1, 0, 0, 0);

  beforeAll(async () => {
    process.env.SHORT_URL_BASE_URL ??= 'http://localhost:3000';
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, RedisService, LinkCacheService, LinksService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    links = moduleRef.get(LinksService);
    await prisma.$connect();
    await prisma.$executeRaw`
      UPDATE links
      SET "clickCount" = 0
      WHERE "clickCount" > ${BigInt(Number.MAX_SAFE_INTEGER)}
    `;
  });

  afterAll(async () => {
    await prisma.link.deleteMany({
      where: { slug: { startsWith: `lb${runId}` } },
    });
    await prisma.$disconnect();
  });

  function uniqueSlug(prefix: string): string {
    return `${prefix}${runId}${randomBytes(2).toString('hex')}`;
  }

  async function bumpCreatedAt(slug: string): Promise<void> {
    tipMs += 1000;
    await prisma.link.update({
      where: { slug },
      data: { createdAt: new Date(tipMs) },
    });
  }

  async function clearTipWindow(): Promise<void> {
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
    tipMs = Date.UTC(2098, 0, 1, 0, 0, 0);
  }

  async function sanitizeUnsafeClickCounts(): Promise<void> {
    await prisma.$executeRaw`
      UPDATE links
      SET "clickCount" = 0
      WHERE "clickCount" > ${BigInt(Number.MAX_SAFE_INTEGER)}
    `;
  }

  it('1 link: correct fields and shortUrl', async () => {
    await sanitizeUnsafeClickCounts();
    const slug = uniqueSlug('l1');
    await links.create({
      url: 'https://example.com/one',
      slug,
      maxClicks: 10,
    });
    await bumpCreatedAt(slug);
    const listed = await links.list();
    const item = listed.items.find((i) => i.slug === slug);
    expect(item).toEqual({
      slug,
      shortUrl: `http://localhost:3000/${slug}`,
      url: 'https://example.com/one',
      active: true,
      expiresAt: null,
      maxClicks: 10,
      clickCount: 0,
      createdAt: expect.any(String),
    });
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('updatedAt');
  });

  it('multiple links → createdAt DESC (among ours)', async () => {
    const older = uniqueSlug('lo');
    const newer = uniqueSlug('ln');
    tipMs += 1000;
    await prisma.link.create({
      data: {
        slug: older,
        destinationUrl: 'https://example.com/older',
        createdAt: new Date(tipMs),
      },
    });
    tipMs += 1000;
    await prisma.link.create({
      data: {
        slug: newer,
        destinationUrl: 'https://example.com/newer',
        createdAt: new Date(tipMs),
      },
    });
    const listed = await links.list();
    const iOlder = listed.items.findIndex((i) => i.slug === older);
    const iNewer = listed.items.findIndex((i) => i.slug === newer);
    expect(iNewer).toBeGreaterThanOrEqual(0);
    expect(iOlder).toBeGreaterThanOrEqual(0);
    expect(iNewer).toBeLessThan(iOlder);
  });

  it('exactly 50 and more than 50 → only the 50 most recent', async () => {
    await clearTipWindow();
    await sanitizeUnsafeClickCounts();
    const batchSlug = `lb${runId}`;
    const base = tipMs + 10_000;
    const data = Array.from({ length: LINK_LIST_LIMIT + 5 }, (_, i) => ({
      slug: `${batchSlug}${String(i).padStart(3, '0')}`,
      destinationUrl: `https://example.com/batch/${i}`,
      createdAt: new Date(base + i * 1000),
    }));
    await prisma.link.createMany({ data });
    tipMs = base + (LINK_LIST_LIMIT + 5) * 1000;

    const listed = await links.list();
    expect(listed.items).toHaveLength(LINK_LIST_LIMIT);

    const our = listed.items.filter((i) => i.slug.startsWith(batchSlug));
    expect(our.length).toBe(LINK_LIST_LIMIT);
    expect(our[0].slug).toBe(
      `${batchSlug}${String(LINK_LIST_LIMIT + 4).padStart(3, '0')}`,
    );
    expect(our[LINK_LIST_LIMIT - 1].slug).toBe(
      `${batchSlug}${String(5).padStart(3, '0')}`,
    );
    for (let i = 0; i < 5; i++) {
      expect(
        listed.items.some(
          (item) => item.slug === `${batchSlug}${String(i).padStart(3, '0')}`,
        ),
      ).toBe(false);
    }

    // Free the top-50 window for later cases
    await prisma.link.deleteMany({
      where: { slug: { startsWith: batchSlug } },
    });
  });

  it('active false / expired / maxed stay listed', async () => {
    const slugDis = uniqueSlug('ld');
    const slugExp = uniqueSlug('le');
    const slugMax = uniqueSlug('lm');
    await links.create({ url: 'https://example.com/dis', slug: slugDis });
    await prisma.link.update({
      where: { slug: slugDis },
      data: { active: false },
    });
    await bumpCreatedAt(slugDis);

    await links.create({ url: 'https://example.com/exp', slug: slugExp });
    await prisma.link.update({
      where: { slug: slugExp },
      data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    await bumpCreatedAt(slugExp);

    await links.create({
      url: 'https://example.com/max',
      slug: slugMax,
      maxClicks: 1,
    });
    await prisma.link.update({
      where: { slug: slugMax },
      data: { clickCount: 1n },
    });
    await bumpCreatedAt(slugMax);

    const listed = await links.list();
    expect(listed.items.find((i) => i.slug === slugDis)?.active).toBe(false);
    expect(listed.items.find((i) => i.slug === slugExp)?.expiresAt).toBe(
      '2020-01-01T00:00:00.000Z',
    );
    expect(listed.items.find((i) => i.slug === slugMax)?.clickCount).toBe(1);
  });

  it('clickCount comes from Link.clickCount, not from AccessEvent', async () => {
    const slug = uniqueSlug('lc');
    await links.create({ url: 'https://example.com/cc', slug });
    const link = await prisma.link.findUniqueOrThrow({ where: { slug } });
    await prisma.link.update({
      where: { id: link.id },
      data: { clickCount: 77n },
    });
    await bumpCreatedAt(slug);
    await prisma.accessEvent.create({
      data: {
        eventId: randomUUID(),
        linkId: link.id,
        accessedAt: new Date(),
      },
    });

    const item = (await links.list()).items.find((i) => i.slug === slug);
    expect(item?.clickCount).toBe(77);
  });

  it('safe BigInt; overflow → InternalServerErrorException', async () => {
    const slugOk = uniqueSlug('lbo');
    await links.create({ url: 'https://example.com/bok', slug: slugOk });
    await prisma.link.update({
      where: { slug: slugOk },
      data: { clickCount: BigInt(Number.MAX_SAFE_INTEGER) },
    });
    await bumpCreatedAt(slugOk);
    expect(
      (await links.list()).items.find((i) => i.slug === slugOk)?.clickCount,
    ).toBe(Number.MAX_SAFE_INTEGER);

    const slugBad = uniqueSlug('lbb');
    await links.create({ url: 'https://example.com/bbad', slug: slugBad });
    await bumpCreatedAt(slugBad);
    await prisma.link.update({
      where: { slug: slugBad },
      data: { clickCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
    });
    try {
      await expect(links.list()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    } finally {
      await prisma.link.update({
        where: { slug: slugBad },
        data: { clickCount: 0n },
      });
    }
  });
});
