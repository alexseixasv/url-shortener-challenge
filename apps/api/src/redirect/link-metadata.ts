export type LinkMetadata = {
  id: string;
  destinationUrl: string;
  active: boolean;
  expiresAt: string | null;
  maxClicks: string | null;
};

export function isLinkCurrentlyValid(
  meta: Pick<LinkMetadata, 'active' | 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  if (!meta.active) {
    return false;
  }
  if (meta.expiresAt == null) {
    return true;
  }
  const expires = new Date(meta.expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return false;
  }
  return expires.getTime() > now.getTime();
}

export function cacheTtlSeconds(
  expiresAt: string | null,
  now: Date = new Date(),
  defaultTtl = 3600,
): number | null {
  if (expiresAt == null) {
    return defaultTtl;
  }
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return null;
  }
  const remaining = Math.floor((expires.getTime() - now.getTime()) / 1000);
  if (remaining <= 0) {
    return null;
  }
  return Math.min(defaultTtl, remaining);
}
