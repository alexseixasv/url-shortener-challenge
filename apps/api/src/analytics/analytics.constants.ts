export const ACCESS_EVENTS_STREAM = 'access_events';
export const ACCESS_EVENTS_DLQ_STREAM = 'access_events:dlq';
export const ANALYTICS_CONSUMER_GROUP = 'analytics-workers';

export const HEADER_MAX_LENGTH = 2048;

export const DEFAULT_CACHE_TTL_SECONDS = 3600;

/** Idle time before XAUTOCLAIM reclaims a pending message (ms). */
export function pendingIdleMs(): number {
  const raw = process.env.ANALYTICS_PENDING_IDLE_MS?.trim();
  const n = raw ? Number(raw) : 60_000;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/** Max process attempts before DLQ + ACK. */
export function maxDeliveryAttempts(): number {
  const raw = process.env.ANALYTICS_MAX_ATTEMPTS?.trim();
  const n = raw ? Number(raw) : 5;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

/** 0 = fire-and-forget (default); >0 awaits enqueue up to this many ms. */
export function enqueueTimeoutMs(): number {
  const raw = process.env.ANALYTICS_ENQUEUE_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function consumerName(): string {
  return (
    process.env.ANALYTICS_CONSUMER_NAME?.trim() ||
    `worker-${process.pid}`
  );
}
