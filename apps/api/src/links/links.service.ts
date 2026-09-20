import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinkCacheService } from '../redirect/link-cache.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import {
  LinkResponseDto,
  toLinkResponse,
} from './dto/link-response.dto.js';
import {
  AUTO_SLUG_MAX_ATTEMPTS,
  generateBase62Slug,
} from './slug.util.js';

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
