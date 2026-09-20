import { describe, expect, it } from 'vitest';
import {
  fillLast7Days,
  formatUtcYmd,
  utcLast7DaysWindow,
} from './stats-window.util.js';
import { bigintToSafeNumber } from './bigint.util.js';

describe('stats-window UTC', () => {
  it('builds exactly 7 ascending UTC days ending today', () => {
    // 2026-09-20T15:30:00Z → window 2026-09-14 … 2026-09-20
    const now = new Date(Date.UTC(2026, 8, 20, 15, 30, 0));
    const w = utcLast7DaysWindow(now);
    expect(w.dates).toHaveLength(7);
    expect(w.dates[0]).toBe('2026-09-14');
    expect(w.dates[6]).toBe('2026-09-20');
    expect(formatUtcYmd(w.start)).toBe('2026-09-14');
    expect(formatUtcYmd(w.end)).toBe('2026-09-20');
  });

  it('uses UTC civil day for an instant that is a different local calendar day', () => {
    // 2026-03-15 02:00Z = still 2026-03-14 evening in America/Sao_Paulo,
    // but UTC day must remain 2026-03-15 regardless of host TZ.
    const instant = new Date('2026-03-15T02:00:00.000Z');
    const w = utcLast7DaysWindow(instant);
    expect(w.dates[6]).toBe('2026-03-15');
    expect(w.dates[0]).toBe('2026-03-09');
    expect(w.dates).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
      '2026-03-15',
    ]);
  });

  it('is stable for the same Date instance (pure UTC getters)', () => {
    const instant = new Date(Date.UTC(2026, 0, 1, 23, 59, 59));
    expect(utcLast7DaysWindow(instant).dates).toEqual(
      utcLast7DaysWindow(instant).dates,
    );
    expect(utcLast7DaysWindow(instant).dates[6]).toBe('2026-01-01');
  });

  it('zero-fills missing daily rows in ascending order', () => {
    const now = new Date(Date.UTC(2026, 8, 20, 12, 0, 0));
    const w = utcLast7DaysWindow(now);
    const filled = fillLast7Days(
      w,
      [
        {
          date: new Date(Date.UTC(2026, 8, 18)),
          clickCount: 5n,
        },
      ],
      bigintToSafeNumber,
    );
    expect(filled).toHaveLength(7);
    expect(filled.map((d) => d.clicks)).toEqual([0, 0, 0, 0, 5, 0, 0]);
    expect(filled[4].date).toBe('2026-09-18');
  });
});
