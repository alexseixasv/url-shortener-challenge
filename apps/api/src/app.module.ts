import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AppController } from './app.controller.js';
import { LinksModule } from './links/links.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedirectModule } from './redirect/redirect.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    LinksModule,
    AnalyticsModule,
    RedirectModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
