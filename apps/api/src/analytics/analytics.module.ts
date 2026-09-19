import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { AnalyticsPublisherService } from './analytics-publisher.service.js';
import { AnalyticsProcessorService } from './analytics-processor.service.js';
import { AnalyticsWorkerService } from './analytics-worker.service.js';

@Module({
  imports: [PrismaModule, RedisModule],
  providers: [
    AnalyticsPublisherService,
    AnalyticsProcessorService,
    AnalyticsWorkerService,
  ],
  exports: [
    AnalyticsPublisherService,
    AnalyticsProcessorService,
    AnalyticsWorkerService,
  ],
})
export class AnalyticsModule {}
