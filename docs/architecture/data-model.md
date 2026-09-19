# Data model

Modelo persistente inicial (PostgreSQL / Prisma). Agregação de stats: ver [ADR-001](../adr/001-access-stats-aggregation.md).

## Entidades

### Link (`links`)

| Campo | Tipo | Notas |
|-------|------|-------|
| id | UUID PK | |
| slug | VARCHAR(64) UNIQUE | |
| destinationUrl | TEXT | |
| active | BOOLEAN DEFAULT true | |
| expiresAt | TIMESTAMPTZ NULL | |
| maxClicks | BIGINT NULL | mesmo domínio que clickCount |
| clickCount | BIGINT DEFAULT 0 | total lifetime (read model) |
| createdAt / updatedAt | TIMESTAMPTZ | |

### AccessEvent (`access_events`)

| Campo | Tipo | Notas |
|-------|------|-------|
| id | BIGSERIAL PK | |
| eventId | UUID UNIQUE | idempotência do worker (ADR-003) |
| linkId | UUID FK → links | ON DELETE RESTRICT |
| accessedAt | TIMESTAMPTZ | instante do redirect |
| referer / userAgent | TEXT NULL | truncados (máx. 2048) |

Índice: `(link_id, accessed_at DESC)` — últimos 20 acessos.  
Agregação: [ADR-001](../adr/001-access-stats-aggregation.md). Autoridade `maxClicks`: [ADR-002](../adr/002-maxclicks-postgresql-authority.md). Analytics: [ADR-003](../adr/003-analytics-redis-streams.md).

### DailyLinkStat (`daily_link_stats`)

| Campo | Tipo | Notas |
|-------|------|-------|
| linkId | UUID | PK composta + FK RESTRICT |
| date | DATE | dia civil **UTC** |
| clickCount | BIGINT DEFAULT 0 | |

PK: `(link_id, date)`.

## Diagrama

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
