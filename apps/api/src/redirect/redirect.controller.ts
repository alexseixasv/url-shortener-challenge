import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RedirectService } from './redirect.service.js';

@Controller()
export class RedirectController {
  constructor(private readonly redirectService: RedirectService) {}

  @Get(':slug')
  async redirect(
    @Param('slug') slug: string,
    @Headers('referer') referer: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { destinationUrl } = await this.redirectService.redirect(slug, {
      referer,
      userAgent,
    });
    res.redirect(HttpStatus.FOUND, destinationUrl);
  }
}
