import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service.js';
import { DEFAULT_CACHE_TTL_SECONDS } from '../analytics/analytics.constants.js';
import {
  LinkMetadata,
  cacheTtlSeconds,
  isLinkCurrentlyValid,
} from './link-metadata.js';

@Injectable()
export class LinkCacheService {
  private readonly logger = new Logger(LinkCacheService.name);

  constructor(private readonly redis: RedisService) {}

  key(slug: string): string {
    return `link:${slug}`;
  }

  async get(slug: string): Promise<LinkMetadata | null> {
    try {
      await this.redis.connect();
      const raw = await this.redis.client.get(this.key(slug));
      if (raw == null) {
        return null;
      }
      return JSON.parse(raw) as LinkMetadata;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`cache get failed for ${slug}: ${message}`);
      return null;
    }
  }

  async set(slug: string, meta: LinkMetadata): Promise<void> {
    if (!isLinkCurrentlyValid(meta)) {
      return;
    }
    const ttl = cacheTtlSeconds(meta.expiresAt, new Date(), DEFAULT_CACHE_TTL_SECONDS);
    if (ttl == null || ttl <= 0) {
      return;
    }
    try {
      await this.redis.connect();
      await this.redis.client.set(
        this.key(slug),
        JSON.stringify(meta),
        'EX',
        ttl,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`cache set failed for ${slug}: ${message}`);
    }
  }
}
