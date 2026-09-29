# ADR-002: PostgreSQL as the authority for maxClicks

## Context

`maxClicks` must stay correct under concurrency. The Redis cache must not become a second authority for redirect authorization. Unlimited links (`maxClicks` null) and capped links can take different paths on the hot path.

## Alternatives considered

### 1. Check then increment

Read `clickCount`, compare it with `maxClicks`, then increment.

- Negative: TOCTOU under concurrency; can authorize past the limit.

### 2. `SELECT FOR UPDATE`

Serializes the row before the increment.

- Negative: more round trips and explicit locks with no clear advantage over a single conditional `UPDATE`.

### 3. Redis counter + stale PostgreSQL fallback

Redis as the gate; on failure, read potentially stale PostgreSQL.

- Negative: two authorities; inconsistent fail-open or fail-closed behavior; cache/stale data does not close the invariant.

### 4. Redis as the durable counter authority

- Negative: Redis stops being cache/queue and becomes the source of truth for a business invariant.

### 5. Atomic conditional `UPDATE` in PostgreSQL (chosen)

A single operation decides authorization for capped links.

## Decision

- **Capped** links: exclusive authorization via an atomic conditional `UPDATE` in PostgreSQL.
- Redis on the redirect stores **metadata only** (no `clickCount` for enforcement).
- `UPDATE` conditions (equivalent):
  - `active = true`
  - `expiresAt` null or in the future
  - `maxClicks IS NOT NULL`
  - `clickCount < maxClicks`
- **1 row** returned → redirect authorized (`preCounted=true` on the analytics event).
- **0 rows** → `410 Gone`.
- **Unlimited** links: no synchronous `clickCount` `UPDATE` on the request; the worker increments after the event.

## Consequences

### Positive

- Strong correctness under concurrency for the click ceiling.
- A single durable authority (PostgreSQL).
- Unlimited avoids the write on the hot path.

### Negative

- Capped pays a PostgreSQL write on every authorized access.
- Hot capped links can see row contention.

## Status

Accepted.
