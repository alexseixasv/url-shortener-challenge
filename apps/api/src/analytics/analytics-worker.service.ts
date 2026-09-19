import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import {
  ACCESS_EVENTS_DLQ_STREAM,
  ACCESS_EVENTS_STREAM,
  ANALYTICS_CONSUMER_GROUP,
  consumerName,
  maxDeliveryAttempts,
  pendingIdleMs,
} from './analytics.constants.js';
import {
  parseAccessEventFields,
  accessEventToStreamFields,
} from './access-event.payload.js';
import { AnalyticsProcessorService } from './analytics-processor.service.js';

type StreamMessage = [id: string, fields: string[]];

@Injectable()
export class AnalyticsWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsWorkerService.name);
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly processor: AnalyticsProcessorService,
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    await this.redis.connect();
    await this.ensureConsumerGroup();
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise;
    }
  }

  async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.client.xgroup(
        'CREATE',
        ACCESS_EVENTS_STREAM,
        ANALYTICS_CONSUMER_GROUP,
        '0',
        'MKSTREAM',
      );
      this.logger.log(
        `consumer group ${ANALYTICS_CONSUMER_GROUP} created on ${ACCESS_EVENTS_STREAM}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('BUSYGROUP')) {
        return;
      }
      throw err;
    }
  }

  private async runLoop(): Promise<void> {
    const name = consumerName();
    this.logger.log(`analytics worker started as ${name}`);

    while (this.running) {
      try {
        await this.reclaimPending(name);
        await this.readNew(name);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`worker loop error: ${message}`);
        await sleep(1_000);
      }
    }
  }

  private async readNew(name: string): Promise<void> {
    const result = (await this.redis.client.xreadgroup(
      'GROUP',
      ANALYTICS_CONSUMER_GROUP,
      name,
      'COUNT',
      10,
      'BLOCK',
      2_000,
      'STREAMS',
      ACCESS_EVENTS_STREAM,
      '>',
    )) as [string, StreamMessage[]][] | null;

    if (!result) {
      return;
    }

    for (const [, messages] of result) {
      for (const [id, fields] of messages) {
        await this.handleMessage(id, fields);
      }
    }
  }

  private async reclaimPending(name: string): Promise<void> {
    const idle = pendingIdleMs();
    try {
      const claimed = (await this.redis.client.xautoclaim(
        ACCESS_EVENTS_STREAM,
        ANALYTICS_CONSUMER_GROUP,
        name,
        idle,
        '0-0',
        'COUNT',
        10,
      )) as [string, StreamMessage[], string[]?];

      const messages = claimed[1] ?? [];
      for (const [id, fields] of messages) {
        await this.handleMessage(id, fields);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`xautoclaim failed: ${message}`);
    }
  }

  /**
   * Process a single stream message (used by the loop and integration tests).
   * XACK only after successful processor COMMIT.
   */
  async processStreamMessage(id: string, fields: string[]): Promise<void> {
    await this.handleMessage(id, fields);
  }

  private async handleMessage(id: string, fields: string[]): Promise<void> {
    const deliveryCount = await this.deliveryCount(id);

    const payload = parseAccessEventFields(fields);
    if (!payload) {
      this.logger.error(
        JSON.stringify({
          msg: 'analytics_poison_invalid_payload',
          streamId: id,
          deliveryCount,
        }),
      );
      await this.moveToDlqAndAck(id, fields, 'invalid_payload');
      return;
    }

    try {
      await this.processor.processEvent(payload);
      await this.redis.client.xack(
        ACCESS_EVENTS_STREAM,
        ANALYTICS_CONSUMER_GROUP,
        id,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        JSON.stringify({
          msg: 'analytics_process_failed',
          streamId: id,
          eventId: payload.eventId,
          deliveryCount,
          error: message,
        }),
      );

      if (deliveryCount >= maxDeliveryAttempts()) {
        await this.moveToDlqAndAck(id, fields, message);
        return;
      }
      // Leave in PEL for reclaim / retry.
    }
  }

  /**
   * Redis PEL delivery counter (survives worker restart). Falls back to 1.
   */
  private async deliveryCount(id: string): Promise<number> {
    try {
      const pending = (await this.redis.client.xpending(
        ACCESS_EVENTS_STREAM,
        ANALYTICS_CONSUMER_GROUP,
        id,
        id,
        1,
      )) as [string, string, number, number][] | null;
      if (pending && pending.length > 0) {
        const timesDelivered = pending[0][3];
        if (typeof timesDelivered === 'number' && timesDelivered > 0) {
          return timesDelivered;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`xpending delivery count failed for ${id}: ${message}`);
    }
    return 1;
  }

  /**
   * ACK only after DLQ accept. If DLQ write fails, leave message in PEL.
   */
  private async moveToDlqAndAck(
    id: string,
    fields: string[],
    reason: string,
  ): Promise<void> {
    try {
      await this.redis.client.xadd(
        ACCESS_EVENTS_DLQ_STREAM,
        '*',
        'originalId',
        id,
        'reason',
        reason,
        ...fields,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        JSON.stringify({
          msg: 'analytics_dlq_write_failed',
          streamId: id,
          reason,
          error: message,
        }),
      );
      return;
    }

    await this.redis.client.xack(
      ACCESS_EVENTS_STREAM,
      ANALYTICS_CONSUMER_GROUP,
      id,
    );
    this.logger.error(
      JSON.stringify({
        msg: 'analytics_poison_moved_to_dlq',
        streamId: id,
        reason,
      }),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Re-export for tests that build stream fields. */
export { accessEventToStreamFields };
