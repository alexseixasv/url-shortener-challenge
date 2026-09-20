import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Trust proxy only when TRUST_PROXY is set explicitly.
 * - "true" / "1" → trust first hop
 * - positive integer → trust that many hops
 * - unset / "false" / "0" → do not trust X-Forwarded-For
 */
export function applyTrustProxyFromEnv(app: INestApplication): void {
  const raw = process.env.TRUST_PROXY?.trim();
  if (raw == null || raw === '' || raw === 'false' || raw === '0') {
    return;
  }
  const expressApp = app as NestExpressApplication;
  if (raw === 'true' || raw === '1') {
    expressApp.set('trust proxy', 1);
    return;
  }
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) {
    expressApp.set('trust proxy', hops);
  }
}
