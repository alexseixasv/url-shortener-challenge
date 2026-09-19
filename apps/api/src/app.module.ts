import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { LinksModule } from './links/links.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, LinksModule],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
