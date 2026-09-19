import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsPublisherService } from './analytics-publisher.service.js';

describe('AnalyticsPublisherService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('swallows enqueue rejection without unhandled rejection', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const redis = {
      connect: vi.fn().mockResolvedValue(undefined),
      client: {
        xadd: vi.fn().mockRejectedValue(new Error('redis down')),
      },
    };
    const publisher = new AnalyticsPublisherService(redis as never);

    publisher.publishAccess({
      linkId: '22222222-2222-2222-2222-222222222222',
      accessedAt: new Date('2026-09-19T12:00:00.000Z'),
      referer: null,
      userAgent: null,
      preCounted: false,
    });

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
  });
});
