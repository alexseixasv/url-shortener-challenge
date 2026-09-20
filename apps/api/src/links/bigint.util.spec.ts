import { describe, expect, it } from 'vitest';
import { bigintToSafeNumber } from './bigint.util.js';

describe('bigintToSafeNumber', () => {
  it('converts values within safe integer range', () => {
    expect(bigintToSafeNumber(0n, 'x')).toBe(0);
    expect(bigintToSafeNumber(10_000_000n, 'x')).toBe(10_000_000);
    expect(bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER), 'x')).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('rejects values above MAX_SAFE_INTEGER without silent loss', () => {
    expect(() =>
      bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'clickCount'),
    ).toThrow(RangeError);
  });
});
