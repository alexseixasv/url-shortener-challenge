import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinkCacheService } from '../redirect/link-cache.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import {
  buildShortUrl,
  LinkResponseDto,
  toLinkResponse,
} from './dto/link-response.dto.js';
import type { LinkListResponseDto } from './dto/link-list-response.dto.js';
import type { LinkStatsResponseDto } from './dto/link-stats-response.dto.js';
import { bigintToSafeNumber } from './bigint.util.js';
import {
  fillLast7Days,
  utcLast7DaysWindow,
} from './stats-window.util.js';
import {
  AUTO_SLUG_MAX_ATTEMPTS,
  generateBase62Slug,
} from './slug.util.js';

/** Max items returned by GET /links (UI listing support). */
export const LINK_LIST_LIMIT = 50;

@Injectable()
export class LinksService {
  /** Overridable for tests (collision / retry scenarios). */
  slugGenerator: () => string = generateBase62Slug;

  constructor(
    private readonly prisma: PrismaService,
    private readonly linkCache: LinkCacheService,
  ) {}

  async create(dto: CreateLinkDto): Promise<LinkResponseDto> {
    const shortUrlBase = this.getShortUrlBase();
    const maxClicks = dto.maxClicks == null ? null : BigInt(dto.maxClicks);
    const expiresAt = dto.expiresAt == null ? null : new Date(dto.expiresAt);

    if (dto.slug != null) {
      return this.createWithCustomSlug(
        dto.slug,
        dto.url,
        expiresAt,
        maxClicks,
        shortUrlBase,
      );
    }

    return this.createWithGeneratedSlug(
      dto.url,
      expiresAt,
      maxClicks,
      shortUrlBase,
    );
  }

  /**
   * Recent links for the UI list (aux endpoint).
   * ORDER BY createdAt DESC LIMIT 50. No Redis, no pagination params.
   * clickCount ← Link.clickCount (never COUNT AccessEvent); eventual consistency accepted.
   * Returns disabled / expired / maxed rows as-is (raw fields; no derived status).
   */
  async list(): Promise<LinkListResponseDto> {
    const shortUrlBase = this.getShortUrlBase();
    const rows = await this.prisma.link.findMany({
      orderBy: { createdAt: 'desc' },
      take: LINK_LIST_LIMIT,
      select: {
        slug: true,
        destinationUrl: true,
        active: true,
        expiresAt: true,
        maxClicks: true,
        clickCount: true,
        createdAt: true,
      },
    });

    try {
      return {
        items: rows.map((row) => ({
          slug: row.slug,
          shortUrl: buildShortUrl(shortUrlBase, row.slug),
          url: row.destinationUrl,
          active: row.active,
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
          maxClicks:
            row.maxClicks == null
              ? null
              : bigintToSafeNumber(row.maxClicks, 'Link.maxClicks'),
          clickCount: bigintToSafeNumber(row.clickCount, 'Link.clickCount'),
          createdAt: row.createdAt.toISOString(),
        })),
      };
    } catch (error) {
      if (error instanceof RangeError) {
        throw new InternalServerErrorException(error.message);
      }
      throw error;
    }
  }

  /**
   * Stats from PG only (no Redis, no cache).
   * totalClicks ← Link.clickCount; last7Days ← DailyLinkStat (UTC window + zero-fill);
   * recentAccesses ← AccessEvent ORDER BY accessedAt DESC LIMIT 20.
   * Available for disabled / expired / maxed links; 404 only if slug missing.
   * Eventual consistency with the worker is accepted as-is.
   */
  async getStats(
    slug: string,
    now: Date = new Date(),
  ): Promise<LinkStatsResponseDto> {
    const link = await this.prisma.link.findUnique({
      where: { slug },
      select: { id: true, slug: true, clickCount: true },
    });
    if (!link) {
      throw new NotFoundException();
    }

    const window = utcLast7DaysWindow(now);

    const [dailyRows, recentRows] = await Promise.all([
      this.prisma.dailyLinkStat.findMany({
        where: {
          linkId: link.id,
          date: { gte: window.start, lte: window.end },
        },
        select: { date: true, clickCount: true },
      }),
      this.prisma.accessEvent.findMany({
        where: { linkId: link.id },
        orderBy: { accessedAt: 'desc' },
        take: 20,
        select: { accessedAt: true, referer: true, userAgent: true },
      }),
    ]);

    let totalClicks: number;
    let last7Days: LinkStatsResponseDto['last7Days'];
    try {
      totalClicks = bigintToSafeNumber(link.clickCount, 'Link.clickCount');
      last7Days = fillLast7Days(window, dailyRows, bigintToSafeNumber);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new InternalServerErrorException(error.message);
      }
      throw error;
    }

    return {
      slug: link.slug,
      totalClicks,
      last7Days,
      recentAccesses: recentRows.map((row) => ({
        accessedAt: row.accessedAt.toISOString(),
        referer: row.referer,
        userAgent: row.userAgent,
      })),
    };
  }

  /**
   * Monotonic disable: active true→false only. Never re-enables.
   * PG update (or already false) then mandatory cache DEL.
   * DEL failure → 503; PG stays false (no compensation).
   */
  async disable(slug: string): Promise<void> {
    const updated = await this.prisma.link.updateMany({
      where: { slug, active: true },
      data: { active: false },
    });

    if (updated.count === 0) {
      const existing = await this.prisma.link.findUnique({
        where: { slug },
        select: { id: true, active: true },
      });
      if (!existing) {
        throw new NotFoundException();
      }
      // already inactive — still must invalidate cache
    }

    try {
      await this.linkCache.delete(slug);
    } catch {
      throw new ServiceUnavailableException(
        'unable to invalidate link cache',
      );
    }
  }

  private async createWithCustomSlug(
    slug: string,
    destinationUrl: string,
    expiresAt: Date | null,
    maxClicks: bigint | null,
    shortUrlBase: string,
  ): Promise<LinkResponseDto> {
    try {
      const link = await this.prisma.link.create({
        data: {
          slug,
          destinationUrl,
          expiresAt,
          maxClicks,
        },
      });
      return toLinkResponse({ ...link, shortUrlBase });
    } catch (error) {
      if (this.isSlugUniqueViolation(error)) {
        throw new ConflictException('slug already exists');
      }
      throw error;
    }
  }

  private async createWithGeneratedSlug(
    destinationUrl: string,
    expiresAt: Date | null,
    maxClicks: bigint | null,
    shortUrlBase: string,
  ): Promise<LinkResponseDto> {
    for (let attempt = 1; attempt <= AUTO_SLUG_MAX_ATTEMPTS; attempt++) {
      const slug = this.slugGenerator();
      try {
        const link = await this.prisma.link.create({
          data: {
            slug,
            destinationUrl,
            expiresAt,
            maxClicks,
          },
        });
        return toLinkResponse({ ...link, shortUrlBase });
      } catch (error) {
        if (
          this.isSlugUniqueViolation(error) &&
          attempt < AUTO_SLUG_MAX_ATTEMPTS
        ) {
          continue;
        }
        if (
          this.isSlugUniqueViolation(error) &&
          attempt >= AUTO_SLUG_MAX_ATTEMPTS
        ) {
          throw new ServiceUnavailableException(
            'unable to allocate a unique slug',
          );
        }
        throw error;
      }
    }

    throw new ServiceUnavailableException('unable to allocate a unique slug');
  }

  private getShortUrlBase(): string {
    const base = process.env.SHORT_URL_BASE_URL?.trim();
    if (!base) {
      throw new Error('SHORT_URL_BASE_URL is not configured');
    }
    return base;
  }

  private isSlugUniqueViolation(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (Array.isArray(target)) {
      return target.includes('slug');
    }
    if (typeof target === 'string') {
      return target.includes('slug');
    }
    return false;
  }
}
