/**
 * Build the last-7-days window in UTC (today UTC + 6 previous civil days).
 * Uses only getUTC* / Date.UTC — independent of process local timezone.
 */
export function formatUtcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type UtcLast7DaysWindow = {
  /** Inclusive start at UTC midnight of (todayUTC - 6). */
  start: Date;
  /** Inclusive end at UTC midnight of todayUTC. */
  end: Date;
  /** Seven YYYY-MM-DD strings, oldest → today (ascending). */
  dates: string[];
};

export function utcLast7DaysWindow(now: Date = new Date()): UtcLast7DaysWindow {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const dates: string[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    dates.push(formatUtcYmd(new Date(Date.UTC(y, m, d - offset))));
  }

  return {
    start: new Date(Date.UTC(y, m, d - 6)),
    end: new Date(Date.UTC(y, m, d)),
    dates,
  };
}

export type DayClicks = { date: string; clicks: number };

/**
 * Merge DB rows into a fixed 7-day series with zeros for missing days.
 */
export function fillLast7Days(
  window: UtcLast7DaysWindow,
  rows: Array<{ date: Date; clickCount: bigint }>,
  toNumber: (v: bigint, field: string) => number,
): DayClicks[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(
      formatUtcYmd(row.date),
      toNumber(row.clickCount, 'dailyLinkStat.clickCount'),
    );
  }
  return window.dates.map((date) => ({
    date,
    clicks: byDate.get(date) ?? 0,
  }));
}
