# ADR-001: Access statistics aggregation

## Context

A link can accumulate more than 10 million individual accesses. The statistics endpoint must return:

- lifetime access total;
- a daily series for the last seven days;
- the last 20 accesses with metadata (referer, user-agent).

Computing those values directly over the event table on every read does not scale on the query path.

## Alternatives considered

### 1. Compute directly from AccessEvent

Each stats query would run `COUNT(*)` and/or `GROUP BY` over the link's events.

- Positive: a single source of truth; no divergence risk.
- Negative: cost proportional to history; not viable at the desired p95 with millions of rows.

### 2. Aggregate only DailyLinkStat

Keep only daily counters and derive the lifetime total with `SUM(click_count)`.

- Positive: the 7-day series stays cheap.
- Negative: the lifetime total requires the full daily history since creation; any gap or partial retention corrupts the total; `SUM` grows with the age of the link.

### 3. Keep `Link.clickCount` + `DailyLinkStat` (chosen)

- `AccessEvent`: granular history (write model / facts).
- `Link.clickCount`: aggregate / read model of the lifetime total.
- `DailyLinkStat`: aggregate / read model for time-series queries (for example, the last 7 days).

The aggregates exist to avoid `COUNT(*)` and `GROUP BY` over millions of `AccessEvent` rows on the stats endpoint.

### 4. Separate totals table

Extract the total into something like `link_totals(link_id, click_count)`.

- Positive: physically separates the aggregate from the rest of the link.
- Negative: an extra join with no clear benefit; the column on `Link` already gives O(1) reads on the same row used by redirect/stats.

## Decision

Adopt alternative 3:

- persist each access in `AccessEvent`;
- keep `links.click_count` as a denormalized lifetime total;
- keep `daily_link_stats` with PK `(link_id, date)` for time series;
- serve the last 20 accesses via an index on `(link_id, accessed_at DESC)` over `AccessEvent`.

## Consequences

### Positive

- Stats cost stays bounded regardless of event volume.
- Model matches the asynchronous flow (the redirect does not wait for a synchronous `INSERT`).
- Clear split between the fact (`AccessEvent`) and the read models (`clickCount`, `DailyLinkStat`).

### Negative

- Eventual consistency between events and aggregates while the worker processes the queue.
- The worker updates the event and the aggregates in the same transaction (see ADR-003); failures require retry/reclaim (covered by the consumer group / DLQ).
- Temporary divergence can show up in stats / `clickCount` until processing finishes.

## Status

Accepted.

## Outside this ADR

The concrete queue/worker mechanism is in [ADR-003](./003-analytics-redis-streams.md). Hot-path `maxClicks` concurrency is in [ADR-002](./002-maxclicks-postgresql-authority.md).
