import {
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnalyticsPublisherService } from '../analytics/analytics-publisher.service.js';
import { LinkCacheService } from './link-cache.service.js';
import {
  LinkMetadata,
  isLinkCurrentlyValid,
} from './link-metadata.js';

export type RedirectRequestMeta = {
  referer?: string | null;
  userAgent?: string | null;
};

type CappedGateRow = {
  id: string;
  destinationUrl: string;
};

@Injectable()
export class RedirectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: LinkCacheService,
    private readonly analytics: AnalyticsPublisherService,
  ) {}

  async redirect(
    slug: string,
    requestMeta: RedirectRequestMeta,
  ): Promise<{ destinationUrl: string }> {
    const meta = await this.resolveMetadata(slug);
    if (!meta) {
      throw new NotFoundException();
    }

    if (!isLinkCurrentlyValid(meta)) {
      throw new GoneException();
    }

    const accessedAt = new Date();
    const isCapped = meta.maxClicks != null;

    if (isCapped) {
      return this.redirectCapped(meta, accessedAt, requestMeta);
    }

    this.analytics.publishAccess({
      linkId: meta.id,
      accessedAt,
      referer: requestMeta.referer,
      userAgent: requestMeta.userAgent,
      preCounted: false,
    });

    return { destinationUrl: meta.destinationUrl };
  }

  private async redirectCapped(
    meta: LinkMetadata,
    accessedAt: Date,
    requestMeta: RedirectRequestMeta,
  ): Promise<{ destinationUrl: string }> {
    const rows = await this.prisma.$queryRaw<CappedGateRow[]>`
      UPDATE "links"
      SET "clickCount" = "clickCount" + 1,
          "updatedAt" = NOW()
      WHERE id = ${meta.id}::uuid
        AND active = true
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
        AND "maxClicks" IS NOT NULL
        AND "clickCount" < "maxClicks"
      RETURNING id, "destinationUrl"
    `;

    if (rows.length === 0) {
      throw new GoneException();
    }

    this.analytics.publishAccess({
      linkId: meta.id,
      accessedAt,
      referer: requestMeta.referer,
      userAgent: requestMeta.userAgent,
      preCounted: true,
    });

    return { destinationUrl: rows[0].destinationUrl };
  }

  private async resolveMetadata(slug: string): Promise<LinkMetadata | null> {
    const cached = await this.cache.get(slug);
    if (cached) {
      return cached;
    }

    const link = await this.prisma.link.findUnique({
      where: { slug },
      select: {
        id: true,
        destinationUrl: true,
        active: true,
        expiresAt: true,
        maxClicks: true,
      },
    });

    if (!link) {
      return null;
    }

    const meta: LinkMetadata = {
      id: link.id,
      destinationUrl: link.destinationUrl,
      active: link.active,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      maxClicks: link.maxClicks == null ? null : link.maxClicks.toString(),
    };

    // Re-check before set so a concurrent disable+DEL cannot be undone by
    // re-warming stale active=true metadata after invalidation.
    if (isLinkCurrentlyValid(meta)) {
      const fresh = await this.prisma.link.findUnique({
        where: { slug },
        select: { active: true, expiresAt: true },
      });
      const stillValid =
        fresh != null &&
        isLinkCurrentlyValid({
          active: fresh.active,
          expiresAt: fresh.expiresAt
            ? fresh.expiresAt.toISOString()
            : null,
        });
      if (!stillValid) {
        return {
          ...meta,
          active: fresh?.active ?? false,
          expiresAt: fresh?.expiresAt
            ? fresh.expiresAt.toISOString()
            : null,
        };
      }
    }

    await this.cache.set(slug, meta);
    return meta;
  }
}

/** Narrow Prisma connectivity errors if needed by callers. */
export function isPrismaUnavailable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError
  );
}
