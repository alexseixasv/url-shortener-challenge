import { randomInt } from 'node:crypto';

export const SLUG_CHARSET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const AUTO_SLUG_LENGTH = 8;
export const AUTO_SLUG_MAX_ATTEMPTS = 5;
export const RESERVED_SLUGS = new Set(['links']);

export function generateBase62Slug(length = AUTO_SLUG_LENGTH): string {
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += SLUG_CHARSET[randomInt(SLUG_CHARSET.length)];
  }
  return slug;
}

export function isValidCustomSlug(slug: string): boolean {
  return /^[0-9A-Za-z]+$/.test(slug) && slug.length >= 1 && slug.length <= 64;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}
