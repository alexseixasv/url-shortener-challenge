import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinkCacheService } from '../redirect/link-cache.service.js';
import { RedisService } from '../redis/redis.service.js';
import { LinksService } from './links.service.js';
import { AUTO_SLUG_MAX_ATTEMPTS, generateBase62Slug } from './slug.util.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.runIf(hasDatabase)('LinksService (integration)', () => {
  let prisma: PrismaService;
  let service: LinksService;

  beforeAll(async () => {
    process.env.SHORT_URL_BASE_URL ??= 'http://localhost:3000';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService, RedisService, LinkCacheService, LinksService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(LinksService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    service.slugGenerator = generateBase62Slug;
  });

  function uniqueSlug(prefix: string): string {
    return `${prefix}${randomBytes(4).toString('hex')}`;
  }

  it('creates a link with only url and returns shortUrl', async () => {
    const created = await service.create({
      url: 'https://example.com/integration-minimal',
    });
    expect(created.slug).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(created.shortUrl).toBe(`http://localhost:3000/${created.slug}`);
    expect(created.maxClicks).toBeNull();
    expect(created.expiresAt).toBeNull();
    expect(created).not.toHaveProperty('clickCount');
  });

  it('persists custom slug and maxClicks as BigInt round-trip number', async () => {
    const slug = uniqueSlug('cust');
    const created = await service.create({
      url: 'https://example.com/full',
      slug,
      maxClicks: 1000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(created.slug).toBe(slug);
    expect(created.maxClicks).toBe(1000);
    expect(typeof created.maxClicks).toBe('number');

    const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
    expect(row.maxClicks).toBe(1000n);
  });

  it('rejects duplicate custom slug with ConflictException', async () => {
    const slug = uniqueSlug('dup');
    await service.create({ url: 'https://example.com/a', slug });
    await expect(
      service.create({ url: 'https://example.com/b', slug }),
    ).rejects.toBeInstanceOf(ConflictException);

    const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
    expect(row.destinationUrl).toBe('https://example.com/a');
  });

  it('enforces UNIQUE under concurrent custom slug creates', async () => {
    const slug = uniqueSlug('race');
    const results = await Promise.allSettled([
      service.create({ url: 'https://example.com/a', slug }),
      service.create({ url: 'https://example.com/b', slug }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    }

    const count = await prisma.link.count({ where: { slug } });
    expect(count).toBe(1);
  });

  it('retries auto slug generation after UNIQUE collision', async () => {
    const colliding = uniqueSlug('auto');
    await prisma.link.create({
      data: {
        slug: colliding,
        destinationUrl: 'https://example.com/seed',
      },
    });

    let calls = 0;
    service.slugGenerator = () => {
      calls += 1;
      return calls === 1 ? colliding : uniqueSlug('ok');
    };

    const created = await service.create({
      url: 'https://example.com/retry',
    });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(created.slug).not.toBe(colliding);
  });

  it('fails after exhausting auto slug retries', async () => {
    const colliding = uniqueSlug('exh');
    await prisma.link.create({
      data: {
        slug: colliding,
        destinationUrl: 'https://example.com/seed',
      },
    });

    service.slugGenerator = () => colliding;

    await expect(
      service.create({ url: 'https://example.com/exhausted' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const count = await prisma.link.count({
      where: { destinationUrl: 'https://example.com/exhausted' },
    });
    expect(count).toBe(0);
    expect(AUTO_SLUG_MAX_ATTEMPTS).toBe(5);
  });

  it('treats Promo and promo as distinct case-sensitive slugs', async () => {
    const suffix = randomBytes(3).toString('hex');
    const upper = `Promo${suffix}`;
    const lower = `promo${suffix}`;

    const a = await service.create({
      url: 'https://example.com/upper',
      slug: upper,
    });
    const b = await service.create({
      url: 'https://example.com/lower',
      slug: lower,
    });

    expect(a.slug).toBe(upper);
    expect(b.slug).toBe(lower);
    expect(a.id).not.toBe(b.id);
  });

  it('accepts maxClicks at Number.MAX_SAFE_INTEGER with BigInt round-trip', async () => {
    const slug = uniqueSlug('max');
    const created = await service.create({
      url: 'https://example.com/max-safe',
      slug,
      maxClicks: Number.MAX_SAFE_INTEGER,
    });

    expect(created.maxClicks).toBe(Number.MAX_SAFE_INTEGER);

    const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
    expect(row.maxClicks).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });
});
