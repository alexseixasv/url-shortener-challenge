import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service.js';
import {
  ACCESS_EVENTS_STREAM,
  HEADER_MAX_LENGTH,
  enqueueTimeoutMs,
} from './analytics.constants.js';
import {
  AccessEventPayload,
  accessEventToStreamFields,
  truncateHeader,
} from './access-event.payload.js';

export type PublishAccessInput = {
  linkId: string;
  accessedAt: Date;
  referer?: string | null;
  userAgent?: string | null;
  preCounted: boolean;
};

@Injectable()
export class AnalyticsPublisherService {
  private readonly logger = new Logger(AnalyticsPublisherService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Best-effort / non-blocking by default.
   * Never throws to the caller; rejections are logged.
   */
  publishAccess(input: PublishAccessInput): void {
    const event: AccessEventPayload = {
      eventId: randomUUID(),
      linkId: input.linkId,
      accessedAt: input.accessedAt.toISOString(),
      referer: truncateHeader(input.referer, HEADER_MAX_LENGTH),
      userAgent: truncateHeader(input.userAgent, HEADER_MAX_LENGTH),
      preCounted: input.preCounted,
    };

    void this.enqueue(event).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        JSON.stringify({
          msg: 'analytics_enqueue_failed',
          eventId: event.eventId,
          linkId: event.linkId,
          error: message,
        }),
      );
    });
  }

  /** Exposed for tests that need to await publish outcome. */
  async enqueue(event: AccessEventPayload): Promise<void> {
    await this.redis.connect();
    const fields = accessEventToStreamFields(event);
    const timeout = enqueueTimeoutMs();
    const xadd = this.redis.client.xadd(
      ACCESS_EVENTS_STREAM,
      '*',
      ...fields,
    );

    if (timeout <= 0) {
      await xadd;
      return;
    }

    await Promise.race([
      xadd,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`analytics enqueue timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);
  }
}
