import { GoneException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AnalyticsPublisherService } from '../analytics/analytics-publisher.service.js';
import { AnalyticsProcessorService } from '../analytics/analytics-processor.service.js';
import { LinkCacheService } from './link-cache.service.js';
import { RedirectService } from './redirect.service.js';
import {
  ACCESS_EVENTS_STREAM,
  ANALYTICS_CONSUMER_GROUP,
} from '../analytics/analytics.constants.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRedis = Boolean(process.env.REDIS_URL);

describe.runIf(hasDatabase)('RedirectService (integration)', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let cache: LinkCacheService;
  let publisher: AnalyticsPublisherService;
  let processor: AnalyticsProcessorService;
  let service: RedirectService;

  beforeAll(async () => {
    process.env.SHORT_URL_BASE_URL ??= 'http://localhost:3000';
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        RedisService,
        LinkCacheService,
        AnalyticsPublisherService,
        AnalyticsProcessorService,
        RedirectService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
    cache = moduleRef.get(LinkCacheService);
    publisher = moduleRef.get(AnalyticsPublisherService);
    processor = moduleRef.get(AnalyticsProcessorService);
    service = moduleRef.get(RedirectService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.onModuleDestroy();
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
        destinationUrl: data.destinationUrl ?? 'https://example.com/dest',
        active: data.active ?? true,
        expiresAt: data.expiresAt === undefined ? null : data.expiresAt,
        maxClicks: data.maxClicks === undefined ? null : data.maxClicks,
        clickCount: data.clickCount ?? 0n,
      },
    });
  }

  beforeEach(async () => {
    if (hasRedis) {
      try {
        await redis.connect();
        const keys = await redis.client.keys('link:*');
        if (keys.length > 0) {
          await redis.client.del(...keys);
        }
      } catch {
        // Redis optional for some cases
      }
    }
  });

  it('cache miss loads PG and populates cache', async () => {
    const slug = uniqueSlug('cmiss');
    const link = await createLink({ slug });

    const result = await service.redirect(slug, {});
    expect(result.destinationUrl).toBe(link.destinationUrl);

    if (hasRedis) {
      const cached = await cache.get(slug);
      expect(cached?.id).toBe(link.id);
    }
  });

  it.runIf(hasRedis)('cache hit serves metadata without requiring PG slug lookup path', async () => {
    const slug = uniqueSlug('chit');
    const link = await createLink({ slug });
    await cache.set(slug, {
      id: link.id,
      destinationUrl: link.destinationUrl,
      active: true,
      expiresAt: null,
      maxClicks: null,
    });

    const spy = vi.spyOn(prisma.link, 'findUnique');
    const result = await service.redirect(slug, {});
    expect(result.destinationUrl).toBe(link.destinationUrl);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('Redis cache unavailable falls back to PostgreSQL', async () => {
    const slug = uniqueSlug('cfall');
    const link = await createLink({ slug });

    const getSpy = vi
      .spyOn(cache, 'get')
      .mockResolvedValue(null);
    const setSpy = vi.spyOn(cache, 'set').mockResolvedValue(undefined);

    const result = await service.redirect(slug, {});
    expect(result.destinationUrl).toBe(link.destinationUrl);

    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('capped concurrency never authorizes more than maxClicks', async () => {
    const slug = uniqueSlug('race');
    const maxClicks = 5n;
    await createLink({ slug, maxClicks, clickCount: 0n });

    const publisherSpy = vi
      .spyOn(publisher, 'publishAccess')
      .mockImplementation(() => undefined);

    const attempts = 20;
    const outcomes = await Promise.allSettled(
      Array.from({ length: attempts }, () => service.redirect(slug, {})),
    );

    const ok = outcomes.filter((o) => o.status === 'fulfilled').length;
    const gone = outcomes.filter(
      (o) =>
        o.status === 'rejected' && o.reason instanceof GoneException,
    ).length;

    expect(ok).toBe(Number(maxClicks));
    expect(gone).toBe(attempts - Number(maxClicks));

    const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
    expect(row.clickCount).toBe(maxClicks);

    publisherSpy.mockRestore();
  });

  it('publisher failure still returns redirect destination', async () => {
    const slug = uniqueSlug('pubf');
    const link = await createLink({ slug });
    const spy = vi.spyOn(publisher, 'publishAccess').mockImplementation(() => {
      // simulate swallow — real publisher never throws
    });

    const result = await service.redirect(slug, {});
    expect(result.destinationUrl).toBe(link.destinationUrl);
    spy.mockRestore();
  });

  it.runIf(hasRedis)(
    'hot path publishes preCounted true for capped and false for unlimited',
    async () => {
      const uncappedSlug = uniqueSlug('pcu');
      const uncapped = await createLink({ slug: uncappedSlug, maxClicks: null });
      const cappedSlug = uniqueSlug('pcc');
      const capped = await createLink({ slug: cappedSlug, maxClicks: 3n });

      const spy = vi.spyOn(publisher, 'publishAccess');
      spy.mockClear();

      await service.redirect(uncappedSlug, {});
      await service.redirect(cappedSlug, {});

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          linkId: uncapped.id,
          preCounted: false,
        }),
      );
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          linkId: capped.id,
          preCounted: true,
        }),
      );
      spy.mockRestore();
    },
  );
  it('worker persists AccessEvent, DailyLinkStat, increments unlimited clickCount', async () => {
    const slug = uniqueSlug('wkul');
    const link = await createLink({ slug, maxClicks: null, clickCount: 0n });
    const eventId = randomUUID();
    const accessedAt = new Date('2026-09-19T15:00:00.000Z');

    await processor.processEvent({
      eventId,
      linkId: link.id,
      accessedAt: accessedAt.toISOString(),
      referer: null,
      userAgent: 'test',
      preCounted: false,
    });

    const events = await prisma.accessEvent.findMany({
      where: { linkId: link.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(eventId);

    const stats = await prisma.dailyLinkStat.findMany({
      where: { linkId: link.id },
    });
    expect(stats).toHaveLength(1);
    expect(stats[0].clickCount).toBe(1n);

    const updated = await prisma.link.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(updated.clickCount).toBe(1n);
  });

  it('worker does not increment clickCount for capped preCounted events', async () => {
    const slug = uniqueSlug('wkcp');
    const link = await createLink({
      slug,
      maxClicks: 10n,
      clickCount: 3n,
    });
    const eventId = randomUUID();

    await processor.processEvent({
      eventId,
      linkId: link.id,
      accessedAt: new Date().toISOString(),
      referer: null,
      userAgent: null,
      preCounted: true,
    });

    const updated = await prisma.link.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(updated.clickCount).toBe(3n);

    const stats = await prisma.dailyLinkStat.findMany({
      where: { linkId: link.id },
    });
    expect(stats[0].clickCount).toBe(1n);
  });

  it('same eventId processed twice does not duplicate aggregates', async () => {
    const slug = uniqueSlug('idem');
    const link = await createLink({ slug, maxClicks: null, clickCount: 0n });
    const eventId = randomUUID();
    const payload = {
      eventId,
      linkId: link.id,
      accessedAt: new Date('2026-09-19T16:00:00.000Z').toISOString(),
      referer: null as string | null,
      userAgent: null as string | null,
      preCounted: false,
    };

    await processor.processEvent(payload);
    await processor.processEvent(payload);

    expect(
      await prisma.accessEvent.count({ where: { linkId: link.id } }),
    ).toBe(1);
    const stats = await prisma.dailyLinkStat.findMany({
      where: { linkId: link.id },
    });
    expect(stats).toHaveLength(1);
    expect(stats[0].clickCount).toBe(1n);
    const updated = await prisma.link.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(updated.clickCount).toBe(1n);
  });

  it.runIf(hasRedis)(
    'redelivery after successful process is idempotent (stream reclaim path)',
    async () => {
      const slug = uniqueSlug('rdlv');
      const link = await createLink({ slug, clickCount: 0n });
      const eventId = randomUUID();
      const payload = {
        eventId,
        linkId: link.id,
        accessedAt: new Date('2026-09-19T17:00:00.000Z').toISOString(),
        referer: null as string | null,
        userAgent: null as string | null,
        preCounted: false,
      };

      await processor.processEvent(payload);
      // Simulate crash after COMMIT before XACK: process again
      await processor.processEvent(payload);

      expect(
        await prisma.accessEvent.count({ where: { eventId } }),
      ).toBe(1);
      expect(
        (
          await prisma.link.findUniqueOrThrow({ where: { id: link.id } })
        ).clickCount,
      ).toBe(1n);

      // Sanity: stream still usable
      await redis.connect();
      const id = await redis.client.xadd(
        ACCESS_EVENTS_STREAM,
        '*',
        'eventId',
        eventId,
        'linkId',
        link.id,
        'accessedAt',
        payload.accessedAt,
        'referer',
        '',
        'userAgent',
        '',
        'preCounted',
        'false',
      );
      expect(id).toBeTruthy();
    },
  );

  it('capped PG gate failure is fail-closed (propagates, does not authorize)', async () => {
    const slug = uniqueSlug('pgfl');
    await createLink({ slug, maxClicks: 5n, clickCount: 0n });

    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(
      new Error('simulated pg unavailable'),
    );

    await expect(service.redirect(slug, {})).rejects.toThrow(
      /simulated pg unavailable/,
    );

    const row = await prisma.link.findUniqueOrThrow({ where: { slug } });
    expect(row.clickCount).toBe(0n);
    spy.mockRestore();
  });

  it('does not cache expired link as valid; cache payload has no clickCount', async () => {
    const slug = uniqueSlug('nocache');
    await createLink({
      slug,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(service.redirect(slug, {})).rejects.toBeInstanceOf(
      GoneException,
    );

    if (hasRedis) {
      const raw = await redis.client.get(cache.key(slug));
      expect(raw).toBeNull();
    }

    const activeSlug = uniqueSlug('noclick');
    const link = await createLink({ slug: activeSlug, clickCount: 42n });
    await service.redirect(activeSlug, {});
    if (hasRedis) {
      const raw = await redis.client.get(cache.key(activeSlug));
      expect(raw).toBeTruthy();
      expect(raw).not.toContain('clickCount');
      expect(JSON.parse(raw!).id).toBe(link.id);
    }
  });

  it.runIf(hasRedis)(
    'worker ACKs only after successful process; failure leaves message pending',
    async () => {
      const { AnalyticsWorkerService } = await import(
        '../analytics/analytics-worker.service.js'
      );
      const moduleRef = await Test.createTestingModule({
        providers: [
          PrismaService,
          RedisService,
          AnalyticsProcessorService,
          AnalyticsWorkerService,
        ],
      }).compile();
      const worker = moduleRef.get(AnalyticsWorkerService);
      const localRedis = moduleRef.get(RedisService);
      await localRedis.connect();
      await worker.ensureConsumerGroup();

      // Drain backlog so XREADGROUP '>' returns only our new message.
      const drainConsumer = `drain-${randomBytes(3).toString('hex')}`;
      for (;;) {
        const batch = (await localRedis.client.xreadgroup(
          'GROUP',
          ANALYTICS_CONSUMER_GROUP,
          drainConsumer,
          'COUNT',
          50,
          'STREAMS',
          ACCESS_EVENTS_STREAM,
          '>',
        )) as [string, [string, string[]][]][] | null;
        if (!batch) {
          break;
        }
        for (const [, messages] of batch) {
          for (const [id] of messages) {
            await localRedis.client.xack(
              ACCESS_EVENTS_STREAM,
              ANALYTICS_CONSUMER_GROUP,
              id,
            );
          }
        }
      }

      const slug = uniqueSlug('xack');
      const link = await createLink({ slug, clickCount: 0n });
      const eventId = randomUUID();
      const fields = [
        'eventId',
        eventId,
        'linkId',
        link.id,
        'accessedAt',
        new Date().toISOString(),
        'referer',
        '',
        'userAgent',
        '',
        'preCounted',
        'false',
      ];

      const streamId = (await localRedis.client.xadd(
        ACCESS_EVENTS_STREAM,
        '*',
        ...fields,
      )) as string;

      const testConsumer = `test-${randomBytes(3).toString('hex')}`;
      const delivered = (await localRedis.client.xreadgroup(
        'GROUP',
        ANALYTICS_CONSUMER_GROUP,
        testConsumer,
        'COUNT',
        1,
        'STREAMS',
        ACCESS_EVENTS_STREAM,
        '>',
      )) as [string, [string, string[]][]][] | null;

      expect(delivered).toBeTruthy();
      const msgId = delivered![0][1][0][0];
      expect(msgId).toBe(streamId);

      const failProcessor = moduleRef.get(AnalyticsProcessorService);
      const failSpy = vi
        .spyOn(failProcessor, 'processEvent')
        .mockRejectedValueOnce(new Error('boom before commit'));

      process.env.ANALYTICS_MAX_ATTEMPTS = '100';
      await worker.processStreamMessage(msgId, fields);

      const pendingAfterFail = (await localRedis.client.xpending(
        ACCESS_EVENTS_STREAM,
        ANALYTICS_CONSUMER_GROUP,
        '-',
        '+',
        10,
      )) as [string, string, number, number][];
      expect(pendingAfterFail.some((p) => p[0] === msgId)).toBe(true);

      failSpy.mockRestore();
      await worker.processStreamMessage(msgId, fields);

      const pendingAfterOk = (await localRedis.client.xpending(
        ACCESS_EVENTS_STREAM,
        ANALYTICS_CONSUMER_GROUP,
        '-',
        '+',
        10,
      )) as [string, string, number, number][];
      expect(pendingAfterOk.some((p) => p[0] === msgId)).toBe(false);

      expect(
        await prisma.accessEvent.count({ where: { eventId } }),
      ).toBe(1);

      await moduleRef.close();
    },
  );

  it('inactive and missing links map to Gone / NotFound', async () => {
    await expect(
      service.redirect(uniqueSlug('miss'), {}),
    ).rejects.toBeInstanceOf(NotFoundException);

    const slug = uniqueSlug('off');
    await createLink({ slug, active: false });
    await expect(service.redirect(slug, {})).rejects.toBeInstanceOf(
      GoneException,
    );
  });
});
