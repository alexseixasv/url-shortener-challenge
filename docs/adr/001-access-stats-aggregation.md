# ADR-001: Agregação de estatísticas de acesso

## Contexto

Links podem acumular mais de 10 milhões de acessos individuais. O endpoint de estatísticas precisa devolver:

- total lifetime de acessos;
- série diária dos últimos sete dias;
- últimos 20 acessos com metadados (referer, user-agent).

Calcular esses valores diretamente sobre a tabela de eventos a cada leitura não escala no caminho de consulta.

## Alternativas consideradas

### 1. Calcular diretamente de AccessEvent

Cada consulta de stats executaria `COUNT(*)` e/ou `GROUP BY` sobre os eventos do link.

- Positivo: uma única fonte de verdade; sem risco de divergência.
- Negativo: custo proporcional ao histórico; inviável com milhões de linhas no p95 desejado.

### 2. Agregar apenas DailyLinkStat

Manter somente contadores diários e derivar o total lifetime com `SUM(click_count)`.

- Positivo: série dos 7 dias fica barata.
- Negativo: o total lifetime exige histórico diário completo desde a criação; qualquer lacuna ou retenção parcial corrompe o total; `SUM` cresce com a idade do link.

### 3. Manter `Link.clickCount` + `DailyLinkStat` (escolhida)

- `AccessEvent`: histórico granular (write model / fatos).
- `Link.clickCount`: agregado / read model do total lifetime.
- `DailyLinkStat`: agregado / read model para consultas temporais (ex.: últimos 7 dias).

Os agregados existem para evitar `COUNT(*)` e `GROUP BY` sobre milhões de `AccessEvent` no endpoint de stats.

### 4. Tabela separada de totais

Extrair o total para algo como `link_totals(link_id, click_count)`.

- Positivo: separa fisicamente o agregado do restante do link.
- Negativo: join adicional sem benefício claro; a coluna em `Link` já atende leitura O(1) no mesmo registro usado no redirect/stats.

## Decisão

Adotar a alternativa 3:

- persistir cada acesso em `AccessEvent`;
- manter `links.click_count` como total lifetime denormalizado;
- manter `daily_link_stats` com PK `(link_id, date)` para séries temporais;
- servir os últimos 20 acessos via índice em `(link_id, accessed_at DESC)` sobre `AccessEvent`.

## Consequências

### Positivas

- Stats com custo limitado independentemente do volume de eventos.
- Modelo alinhado ao fluxo assíncrono previsto no README (redirect não espera `INSERT` síncrono).
- Separação clara entre fato (`AccessEvent`) e read models (`clickCount`, `DailyLinkStat`).

### Negativas

- Consistência eventual entre eventos e agregados quando o processamento assíncrono for implementado.
- Worker futuro precisa atualizar dois agregados (e inserir o evento) de forma correta.
- Possível divergência temporária se o processamento falhar; exige estratégia de retry/reprocessamento (fora deste ADR).

## Status

Accepted.

## Fora deste ADR

O mecanismo concreto de processamento assíncrono (fila, broker, worker) **não** é decidido aqui. A estratégia de concorrência de `maxClicks` no hot path também permanece aberta.
