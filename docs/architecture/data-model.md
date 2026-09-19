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
| linkId | UUID FK → links | ON DELETE RESTRICT |
| accessedAt | TIMESTAMPTZ | |
| referer / userAgent | TEXT NULL | |

Índice: `(link_id, accessed_at DESC)` — últimos 20 acessos.

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
