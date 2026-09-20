import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { AppModule } from '../src/app.module.js';
import { applyTrustProxyFromEnv } from '../src/trust-proxy.js';

export async function createTestApp(): Promise<{
  app: INestApplication<Server>;
  moduleFixture: TestingModule;
}> {
  process.env.SHORT_URL_BASE_URL ??= 'http://localhost:3000';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  // Non–rate-limit e2e suites share one client IP; raise default so POST volume
  // across files does not hit 429. Rate-limit specs set MAX explicitly first.
  process.env.RATE_LIMIT_POST_LINKS_MAX ??= '10000';

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  applyTrustProxyFromEnv(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  await app.init();
  return { app, moduleFixture };
}
