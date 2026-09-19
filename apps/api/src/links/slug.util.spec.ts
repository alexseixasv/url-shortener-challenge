import { describe, expect, it } from 'vitest';
import {
  AUTO_SLUG_LENGTH,
  generateBase62Slug,
  isReservedSlug,
  isValidCustomSlug,
  SLUG_CHARSET,
} from './slug.util.js';

describe('slug.util', () => {
  it('generates Base62 slug of configured length', () => {
    const slug = generateBase62Slug();
    expect(slug).toHaveLength(AUTO_SLUG_LENGTH);
    expect(Array.from(slug).every((c) => SLUG_CHARSET.includes(c))).toBe(true);
  });

  it('generates varying values across calls', () => {
    const samples = new Set(
      Array.from({ length: 20 }, () => generateBase62Slug()),
    );
    expect(samples.size).toBeGreaterThan(1);
  });

  it('validates custom slug charset and length', () => {
    expect(isValidCustomSlug('a')).toBe(true);
    expect(isValidCustomSlug('Ab12')).toBe(true);
    expect(isValidCustomSlug('a'.repeat(64))).toBe(true);
    expect(isValidCustomSlug('')).toBe(false);
    expect(isValidCustomSlug('a'.repeat(65))).toBe(false);
    expect(isValidCustomSlug('has-dash')).toBe(false);
    expect(isValidCustomSlug('has space')).toBe(false);
  });

  it('marks reserved slugs', () => {
    expect(isReservedSlug('links')).toBe(true);
    expect(isReservedSlug('Links')).toBe(false);
    expect(isReservedSlug('promo')).toBe(false);
  });
});
