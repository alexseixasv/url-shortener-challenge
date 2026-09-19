import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessEventPayload } from './access-event.payload.js';

@Injectable()
export class AnalyticsProcessorService {
  private readonly logger = new Logger(AnalyticsProcessorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent persistence: same eventId → one AccessEvent, aggregates once.
   * Capped (preCounted): never increments Link.clickCount again.
   */
  async processEvent(event: AccessEventPayload): Promise<void> {
    const accessedAt = new Date(event.accessedAt);
    if (Number.isNaN(accessedAt.getTime())) {
      throw new Error(`invalid accessedAt: ${event.accessedAt}`);
    }

    const utcDate = utcCalendarDate(accessedAt);

    await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO "access_events" ("eventId", "linkId", "accessedAt", "referer", "userAgent")
        VALUES (${event.eventId}::uuid, ${event.linkId}::uuid, ${accessedAt}, ${event.referer}, ${event.userAgent})
        ON CONFLICT ("eventId") DO NOTHING
      `;

      if (inserted === 0) {
        this.logger.debug(
          `duplicate eventId=${event.eventId}; skipping aggregates`,
        );
        return;
      }

      await tx.$executeRaw`
        INSERT INTO "daily_link_stats" ("linkId", "date", "clickCount")
        VALUES (${event.linkId}::uuid, ${utcDate}::date, 1)
        ON CONFLICT ("linkId", "date")
        DO UPDATE SET "clickCount" = "daily_link_stats"."clickCount" + 1
      `;

      if (!event.preCounted) {
        await tx.$executeRaw`
          UPDATE "links"
          SET "clickCount" = "clickCount" + 1,
              "updatedAt" = NOW()
          WHERE id = ${event.linkId}::uuid
        `;
      }
    });
  }
}

function utcCalendarDate(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** @internal test helper type guard */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
