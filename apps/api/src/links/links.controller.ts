import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { LinkResponseDto } from './dto/link-response.dto.js';
import { LinksService } from './links.service.js';

@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateLinkDto): Promise<LinkResponseDto> {
    return this.linksService.create(dto);
  }
}
