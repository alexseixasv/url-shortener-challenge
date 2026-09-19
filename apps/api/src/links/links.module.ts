import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinksController } from './links.controller.js';
import { LinksService } from './links.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [LinksController],
  providers: [LinksService],
})
export class LinksModule {}
