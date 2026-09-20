import { describe, expect, it } from 'vitest';
import { normalizeCreatePayload } from './normalize-create-payload.js';

describe('normalizeCreatePayload', () => {
  it('sends only url when optionals are empty', () => {
    expect(
      normalizeCreatePayload({
        url: ' https://example.com ',
        slug: '  ',
        expiresAtLocal: '',
        maxClicks: '',
      }),
    ).toEqual({ url: 'https://example.com' });
  });

  it('includes slug, ISO expiresAt, and integer maxClicks', () => {
    const payload = normalizeCreatePayload({
      url: 'https://example.com',
      slug: 'abc',
      expiresAtLocal: '2099-01-15T10:30',
      maxClicks: '42',
    });
    expect(payload.url).toBe('https://example.com');
    expect(payload.slug).toBe('abc');
    expect(payload.maxClicks).toBe(42);
    expect(payload.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.parse(payload.expiresAt!)).not.toBeNaN();
  });

  it('omits invalid maxClicks', () => {
    expect(
      normalizeCreatePayload({
        url: 'https://example.com',
        slug: '',
        expiresAtLocal: '',
        maxClicks: '1.5',
      }),
    ).toEqual({ url: 'https://example.com' });
  });
});
