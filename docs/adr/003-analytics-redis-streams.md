# ADR-003: Analytics via Redis Streams

## Contexto

Cada acesso válido deve gerar um evento individual. Analytics não pode impedir o redirect (`302`). Depois que a infraestrutura de fila aceita o evento, queremos recuperação se o worker cair. `LPUSH` + `BRPOP` remove a mensagem no dequeue: crash antes do commit no PostgreSQL perde o evento pós-aceite.

## Alternativas consideradas

### 1. Redis List (`LPUSH` + `BRPOP`)

- Positivo: API mínima; worker simples.
- Negativo: at-most-once após o pop; crash pós-dequeue perde evento já aceito.

### 2. Outbox síncrono no PostgreSQL no hot path

- Negativo: coloca persistência de analytics no caminho do redirect; conflita com o budget de latência.

### 3. Redis Streams + consumer group + idempotência (escolhida)

- `XADD` aceita o evento; pending até `XACK`.
- Redelivery após crash exige deduplicação na persistência.

## Decisão

- Fila: Redis Streams (`access_events`).
- Consumer group: `analytics-workers`.
- Cada evento carrega `eventId` UUID gerado na API.
- Worker: `XREADGROUP` → transação PostgreSQL idempotente → `XACK` **somente após** `COMMIT`.
- Persistência: `AccessEvent.eventId` UNIQUE; `INSERT … ON CONFLICT DO NOTHING`; agregados (`DailyLinkStat`, `clickCount` unlimited) só se o insert criou linha.
- Reclaim de pending (`XAUTOCLAIM`) para consumers mortos.
- Enqueue no request: **best-effort / non-blocking** por padrão (fire-and-forget com handling de rejeição). Timeout awaited opcional via `ANALYTICS_ENQUEUE_TIMEOUT_MS` (`0` = non-blocking).
- Poison messages: após N tentativas, log + DLQ stream + `ACK` da original.

## Consequências

### Positivas

- Perda pós-aceite por crash do worker é recuperável (at-least-once + dedup).
- Redirect não depende do sucesso do publish.
- Alinhado a ADR-001 (fato + agregados no worker).

### Negativas

- Perda pré-aceite ainda é possível (Redis indisponível / processo morre antes do `XADD` completar).
- At-least-once exige idempotência (`eventId` UNIQUE + migration).
- Worker mais complexo que `BRPOP`.

## Status

Accepted.
