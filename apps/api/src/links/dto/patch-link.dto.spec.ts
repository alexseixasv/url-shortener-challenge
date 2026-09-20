import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PatchLinkDto } from './patch-link.dto.js';

describe('PatchLinkDto', () => {
  async function validateBody(body: unknown) {
    const dto = plainToInstance(PatchLinkDto, body);
    return validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it('accepts { active: false }', async () => {
    const errors = await validateBody({ active: false });
    expect(errors).toHaveLength(0);
  });

  it('rejects active true', async () => {
    const errors = await validateBody({ active: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty body and unknown fields', async () => {
    expect((await validateBody({})).length).toBeGreaterThan(0);
    expect(
      (await validateBody({ active: false, url: 'https://x.com' })).length,
    ).toBeGreaterThan(0);
  });
});
