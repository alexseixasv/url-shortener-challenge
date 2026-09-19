import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateLinkDto } from './create-link.dto.js';

async function validateDto(plain: Record<string, unknown>) {
  const dto = plainToInstance(CreateLinkDto, plain);
  return validate(dto);
}

describe('CreateLinkDto', () => {
  it('accepts minimal valid url', async () => {
    const errors = await validateDto({ url: 'https://example.com/page' });
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid protocols and malformed urls', async () => {
    for (const url of [
      'ftp://example.com',
      'javascript:alert(1)',
      '/relative',
      '',
      'not-a-url',
    ]) {
      const errors = await validateDto({ url });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('accepts http and https', async () => {
    expect(
      await validateDto({ url: 'http://example.com' }),
    ).toHaveLength(0);
    expect(
      await validateDto({ url: 'https://example.com' }),
    ).toHaveLength(0);
  });

  it('rejects invalid slugs and reserved links', async () => {
    expect(
      (await validateDto({ url: 'https://example.com', slug: 'bad-slug' }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await validateDto({ url: 'https://example.com', slug: 'links' }))
        .length,
    ).toBeGreaterThan(0);
    expect(
      await validateDto({ url: 'https://example.com', slug: 'OkSlug1' }),
    ).toHaveLength(0);
  });

  it('rejects past expiresAt and accepts future', async () => {
    const past = await validateDto({
      url: 'https://example.com',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(past.length).toBeGreaterThan(0);

    const future = await validateDto({
      url: 'https://example.com',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(future).toHaveLength(0);
  });

  it('rejects invalid maxClicks values', async () => {
    for (const maxClicks of [0, -1, 1.5]) {
      const errors = await validateDto({
        url: 'https://example.com',
        maxClicks,
      });
      expect(errors.length).toBeGreaterThan(0);
    }
    expect(
      await validateDto({ url: 'https://example.com', maxClicks: 1000 }),
    ).toHaveLength(0);
  });

  it('rejects explicit null on optional fields', async () => {
    for (const body of [
      { url: 'https://example.com', slug: null },
      { url: 'https://example.com', expiresAt: null },
      { url: 'https://example.com', maxClicks: null },
    ]) {
      const errors = await validateDto(body);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('enforces custom slug length 1..64 on the DTO path', async () => {
    expect(
      await validateDto({ url: 'https://example.com', slug: 'a' }),
    ).toHaveLength(0);
    expect(
      await validateDto({ url: 'https://example.com', slug: 'a'.repeat(64) }),
    ).toHaveLength(0);
    expect(
      (
        await validateDto({
          url: 'https://example.com',
          slug: 'a'.repeat(65),
        })
      ).length,
    ).toBeGreaterThan(0);
  });

  it('rejects maxClicks above Number.MAX_SAFE_INTEGER', async () => {
    const errors = await validateDto({
      url: 'https://example.com',
      maxClicks: Number.MAX_SAFE_INTEGER + 1,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
