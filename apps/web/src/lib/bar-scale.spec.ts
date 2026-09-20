import { describe, expect, it } from 'vitest';
import { barWidthPercent, maxClicksInWindow } from './bar-scale.js';

describe('bar-scale', () => {
  it('uses max(..., 1) so all-zero window yields 0% widths', () => {
    const max = maxClicksInWindow([0, 0, 0, 0, 0, 0, 0]);
    expect(max).toBe(0);
    expect(barWidthPercent(0, max)).toBe(0);
  });

  it('scales relative to the window max', () => {
    expect(barWidthPercent(5, 10)).toBe(50);
    expect(barWidthPercent(10, 10)).toBe(100);
  });
});
