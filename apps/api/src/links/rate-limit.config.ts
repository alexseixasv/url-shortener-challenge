export type PostLinksRateLimitConfig = {
  max: number;
  windowSeconds: number;
};

const DEFAULT_MAX = 30;
const DEFAULT_WINDOW_SECONDS = 60;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return fallback;
  }
  return n;
}

/** Reads env on each call so tests can override before requests. */
export function getPostLinksRateLimitConfig(): PostLinksRateLimitConfig {
  return {
    max: parsePositiveInt(
      process.env.RATE_LIMIT_POST_LINKS_MAX,
      DEFAULT_MAX,
    ),
    windowSeconds: parsePositiveInt(
      process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS,
      DEFAULT_WINDOW_SECONDS,
    ),
  };
}

export function postLinksRateLimitKey(ip: string): string {
  const safe = ip.trim().length > 0 ? ip.trim() : 'unknown';
  return `rl:post-links:${safe}`;
}

export const DEFAULT_POST_LINKS_RATE_LIMIT_MAX = DEFAULT_MAX;
export const DEFAULT_POST_LINKS_RATE_LIMIT_WINDOW_SECONDS =
  DEFAULT_WINDOW_SECONDS;
