/** Avoid division by zero when all daily clicks are 0. */
export function barWidthPercent(clicks: number, maxClicks: number): number {
  const max = Math.max(maxClicks, 1);
  return Math.min(100, Math.round((clicks / max) * 100));
}

export function maxClicksInWindow(clicks: number[]): number {
  if (clicks.length === 0) {
    return 0;
  }
  return Math.max(...clicks);
}
