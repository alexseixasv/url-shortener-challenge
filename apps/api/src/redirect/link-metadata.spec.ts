import { describe, expect, it } from 'vitest';
import {
  cacheTtlSeconds,
  isLinkCurrentlyValid,
} from './link-metadata.js';

describe('link-metadata helpers', () => {
  const now = new Date('2026-09-19T12:00:00.000Z');

  it('rejects inactive and expired links', () => {
    expect(
      isLinkCurrentlyValid(
        { active: false, expiresAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isLinkCurrentlyValid(
        { active: true, expiresAt: '2026-09-19T11:00:00.000Z' },
        now,
      ),
    ).toBe(false);
  });

  it('accepts active unlimited and future expiry', () => {
    expect(
      isLinkCurrentlyValid({ active: true, expiresAt: null }, now),
    ).toBe(true);
    expect(
      isLinkCurrentlyValid(
        { active: true, expiresAt: '2026-09-19T13:00:00.000Z' },
        now,
      ),
    ).toBe(true);
  });

  it('computes TTL as min(3600, expiresAt - now)', () => {
    expect(cacheTtlSeconds(null, now, 3600)).toBe(3600);
    expect(
      cacheTtlSeconds('2026-09-19T12:30:00.000Z', now, 3600),
    ).toBe(1800);
    expect(
      cacheTtlSeconds('2026-09-19T14:00:00.000Z', now, 3600),
    ).toBe(3600);
    expect(
      cacheTtlSeconds('2026-09-19T11:00:00.000Z', now, 3600),
    ).toBeNull();
  });
});
