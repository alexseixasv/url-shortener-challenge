import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedirectModule } from '../redirect/redirect.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { LinksController } from './links.controller.js';
import { LinksService } from './links.service.js';
import { PostLinksRateLimitGuard } from './post-links-rate-limit.guard.js';
import { RateLimitService } from './rate-limit.service.js';

@Module({
  imports: [PrismaModule, RedisModule, RedirectModule],
  controllers: [LinksController],
  providers: [LinksService, RateLimitService, PostLinksRateLimitGuard],
})
export class LinksModule {}
