# Data model

Persistent model (PostgreSQL / Prisma). Stats aggregation: see [ADR-001](../adr/001-access-stats-aggregation.md).

## Entities

### Link (`links`)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| slug | VARCHAR(64) UNIQUE | |
| destinationUrl | TEXT | |
| active | BOOLEAN DEFAULT true | |
| expiresAt | TIMESTAMPTZ NULL | |
| maxClicks | BIGINT NULL | same domain as clickCount |
| clickCount | BIGINT DEFAULT 0 | lifetime total (read model) |
| createdAt / updatedAt | TIMESTAMPTZ | |

### AccessEvent (`access_events`)

| Field | Type | Notes |
|-------|------|-------|
| id | BIGSERIAL PK | |
| eventId | UUID UNIQUE | worker idempotency (ADR-003) |
| linkId | UUID FK → links | ON DELETE RESTRICT |
| accessedAt | TIMESTAMPTZ | redirect instant |
| referer / userAgent | TEXT NULL | truncated (max 2048) |

Index: `(link_id, accessed_at DESC)` — last 20 accesses.  
Aggregation: [ADR-001](../adr/001-access-stats-aggregation.md). `maxClicks` authority: [ADR-002](../adr/002-maxclicks-postgresql-authority.md). Analytics: [ADR-003](../adr/003-analytics-redis-streams.md).

### DailyLinkStat (`daily_link_stats`)

| Field | Type | Notes |
|-------|------|-------|
| linkId | UUID | composite PK + FK RESTRICT |
| date | DATE | **UTC** civil day |
| clickCount | BIGINT DEFAULT 0 | |

PK: `(link_id, date)`.

## Diagram

```mermaid
erDiagram
  Link ||--o{ AccessEvent : has
  Link ||--o{ DailyLinkStat : has
  Link {
    uuid id PK
    varchar slug UK
    text destinationUrl
    boolean active
    timestamptz expiresAt
    bigint maxClicks
    bigint clickCount
  }
  AccessEvent {
    bigint id PK
    uuid eventId UK
    uuid linkId FK
    timestamptz accessedAt
    text referer
    text userAgent
  }
  DailyLinkStat {
    uuid linkId PK_FK
    date date PK
    bigint clickCount
  }
```
