import { describe, expect, it } from 'vitest';
import { toLinkResponse } from './link-response.dto.js';

describe('toLinkResponse', () => {
  it('strips trailing slashes from SHORT_URL_BASE_URL', () => {
    const response = toLinkResponse({
      id: '00000000-0000-0000-0000-000000000001',
      slug: 'Ab12Cd34',
      destinationUrl: 'https://example.com',
      expiresAt: null,
      maxClicks: 10n,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      shortUrlBase: 'http://localhost:3000/',
    });

    expect(response.shortUrl).toBe('http://localhost:3000/Ab12Cd34');
    expect(response.maxClicks).toBe(10);
    expect(response.expiresAt).toBeNull();
  });
});
