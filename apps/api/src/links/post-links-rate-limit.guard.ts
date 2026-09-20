import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service.js';

@Injectable()
export class PostLinksRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip =
      typeof req.ip === 'string' && req.ip.trim().length > 0
        ? req.ip.trim()
        : 'unknown';

    const result = await this.rateLimit.consumePostLinks(ip);
    if (result.allowed) {
      return true;
    }

    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'rate limit exceeded',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
