import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { PatchLinkDto } from './dto/patch-link.dto.js';
import { LinkResponseDto } from './dto/link-response.dto.js';
import type { LinkStatsResponseDto } from './dto/link-stats-response.dto.js';
import { LinksService } from './links.service.js';
import { PostLinksRateLimitGuard } from './post-links-rate-limit.guard.js';

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  @UseGuards(PostLinksRateLimitGuard)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateLinkDto): Promise<LinkResponseDto> {
    return this.linksService.create(dto);
  }

  @Get(':slug/stats')
  getStats(@Param('slug') slug: string): Promise<LinkStatsResponseDto> {
    return this.linksService.getStats(slug);
  }

  @Patch(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(
    @Param('slug') slug: string,
    @Body() _dto: PatchLinkDto,
  ): Promise<void> {
    await this.linksService.disable(slug);
  }
}
