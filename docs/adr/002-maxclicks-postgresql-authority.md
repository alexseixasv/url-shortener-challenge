# ADR-002: Autoridade de maxClicks no PostgreSQL

## Contexto

`maxClicks` precisa permanecer correto sob concorrência. O cache Redis não pode criar uma segunda autoridade para autorização de redirect. Links unlimited (`maxClicks` null) e capped podem seguir caminhos diferentes no hot path.

## Alternativas consideradas

### 1. Check then increment

Ler `clickCount`, comparar com `maxClicks`, depois incrementar.

- Negativo: TOCTOU sob concorrência; pode autorizar além do limite.

### 2. `SELECT FOR UPDATE`

Serializa a linha antes do incremento.

- Negativo: mais round trips e locks explícitos sem vantagem clara frente a um único `UPDATE` condicional.

### 3. Contador Redis + fallback stale no PostgreSQL

Redis como gate; em falha, consultar PG potencialmente desatualizado.

- Negativo: duas autoridades; fail-open ou fail-closed inconsistentes; cache/stale não fecham o invariant.

### 4. Redis como autoridade durável do contador

- Negativo: Redis deixa de ser cache/fila e passa a ser source of truth para um invariant de negócio.

### 5. `UPDATE` condicional atômico no PostgreSQL (escolhida)

Uma única operação decide autorização para links capped.

## Decisão

- Links **capped**: autorização exclusiva via PostgreSQL com `UPDATE` condicional atômico.
- Redis no redirect armazena **somente metadata** (sem `clickCount` para enforcement).
- Condições do `UPDATE` (equivalente):
  - `active = true`
  - `expiresAt` nulo ou no futuro
  - `maxClicks IS NOT NULL`
  - `clickCount < maxClicks`
- **1 row** retornada → redirect autorizado (`preCounted=true` no evento de analytics).
- **0 rows** → `410 Gone`.
- Links **unlimited**: sem `UPDATE` síncrono de `clickCount` no request; o worker incrementa após o evento.

## Consequências

### Positivas

- Correção forte sob concorrência para o teto de cliques.
- Uma única autoridade durável (PostgreSQL).
- Unlimited evita o write no hot path.

### Negativas

- Capped paga um write no PostgreSQL a cada acesso autorizado.
- Links capped quentes podem sofrer contenção de linha.

## Status

Accepted.
