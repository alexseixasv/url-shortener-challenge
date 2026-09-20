import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { LinkCacheService } from './link-cache.service.js';
import { RedirectController } from './redirect.controller.js';
import { RedirectService } from './redirect.service.js';

@Module({
  imports: [PrismaModule, RedisModule, AnalyticsModule],
  controllers: [RedirectController],
  providers: [RedirectService, LinkCacheService],
  exports: [RedirectService, LinkCacheService],
})
export class RedirectModule {}
