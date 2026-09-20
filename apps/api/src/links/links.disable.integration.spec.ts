import {
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinkCacheService } from '../redirect/link-cache.service.js';
import { RedisService } from '../redis/redis.service.js';
import { RedirectService } from '../redirect/redirect.service.js';
import { AnalyticsPublisherService } from '../analytics/analytics-publisher.service.js';
import { LinksService } from './links.service.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRedis = Boolean(process.env.REDIS_URL);

describe.runIf(hasDatabase && hasRedis)(
  'LinksService.disable (integration)',
  () => {
    let prisma: PrismaService;
    let redis: RedisService;
    let cache: LinkCacheService;
    let links: LinksService;
    let redirect: RedirectService;

    beforeAll(async () => {
      process.env.SHORT_URL_BASE_URL ??= 'http://localhost:3000';
      process.env.REDIS_URL ??= 'redis://localhost:6379';
      const moduleRef = await Test.createTestingModule({
        providers: [
          PrismaService,
          RedisService,
          LinkCacheService,
          LinksService,
          AnalyticsPublisherService,
          RedirectService,
        ],
      }).compile();
      prisma = moduleRef.get(PrismaService);
      redis = moduleRef.get(RedisService);
      cache = moduleRef.get(LinkCacheService);
      links = moduleRef.get(LinksService);
      redirect = moduleRef.get(RedirectService);
      await prisma.$connect();
      await redis.connect();
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await redis.onModuleDestroy();
    });

    function uniqueSlug(prefix: string): string {
      return `${prefix}${randomBytes(4).toString('hex')}`;
    }

    it('warms unlimited cache, disable deletes key, GET path sees gone', async () => {
      const slug = uniqueSlug('disu');
      const created = await links.create({
        url: 'https://example.com/disable-unlim',
        slug,
      });
      expect(created).not.toHaveProperty('active');

      await redirect.redirect(slug, {});
      let warm = await cache.get(slug);
      if (warm == null) {
        // Ensure warm entry for invalidation assertion (cache set is best-effort).
        const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
        await redis.client.set(
          cache.key(slug),
          JSON.stringify({
            id: row.id,
            destinationUrl: row.destinationUrl,
            active: true,
            expiresAt: null,
            maxClicks: null,
          }),
          'EX',
          3600,
        );
        warm = await cache.get(slug);
      }
      expect(warm?.active).toBe(true);

      await links.disable(slug);

      expect(await redis.client.get(cache.key(slug))).toBeNull();
      const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
      expect(row.active).toBe(false);

      await expect(redirect.redirect(slug, {})).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('Redis DEL failure returns 503 and keeps active=false (no compensate)', async () => {
      const slug = uniqueSlug('d503');
      await links.create({ url: 'https://example.com/503', slug });

      const delSpy = vi
        .spyOn(cache, 'delete')
        .mockRejectedValueOnce(new Error('redis del failed'));

      await expect(links.disable(slug)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
      expect(row.active).toBe(false);

      delSpy.mockRestore();

      // recovery retry
      await links.disable(slug);
      expect(await redis.client.get(cache.key(slug))).toBeNull();
      expect(
        (await prisma.link.findUniqueOrThrow({ where: { slug } })).active,
      ).toBe(false);
    });

    it('concurrent disables never re-enable the link', async () => {
      const slug = uniqueSlug('drace');
      await links.create({ url: 'https://example.com/race', slug });

      await Promise.all([
        links.disable(slug),
        links.disable(slug),
        links.disable(slug),
      ]);

      expect(
        (await prisma.link.findUniqueOrThrow({ where: { slug } })).active,
      ).toBe(false);
    });

    it('unknown slug → NotFoundException', async () => {
      await expect(links.disable(uniqueSlug('miss'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  },
);
