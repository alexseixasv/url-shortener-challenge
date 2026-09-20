import type { INestApplication } from '@nestjs/common';

/**
 * Browser ↔ API CORS. Default matches Vite web port in local/compose.
 * Set CORS_ORIGIN to the exact frontend origin (no wildcard needed for the challenge).
 */
export function applyCorsFromEnv(app: INestApplication): void {
  const origin =
    process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173';
  app.enableCors({
    origin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
  });
}
