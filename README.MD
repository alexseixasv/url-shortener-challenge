# Encurtador de URLs

Implementação de um desafio técnico para construção de um encurtador de URLs com estatísticas de acesso.

Antes de começar a implementação, preferi registrar minha leitura do problema, os pontos que considero mais críticos e as decisões iniciais de arquitetura.

Algumas dessas decisões ainda podem mudar durante o desenvolvimento caso a implementação revele algum trade-off que não esteja evidente neste momento.

> **Status atual:** backend completo para o challenge (`POST/GET/PATCH` links, redirect, stats, analytics Redis Streams, rate limit) e **frontend React** em `apps/web` (create / list / stats / disable) com identidade Kiip.

---

## Ambiente local

Com Docker instalado:

```bash
cp .env.example .env
docker compose up --build
```

Isso sobe PostgreSQL, Redis, API, **worker** e Web. A API e o worker esperam Postgres/Redis healthy, aplicam as migrations versionadas com `prisma migrate deploy` e só então iniciam. Não é necessário entrar no container para `pnpm install`, `migrate`, criar consumer group ou `db push`.

`prisma generate` ocorre no **build** da imagem (Dockerfile), não a cada restart.

Se você alterar `apps/api/package.json` depois de já ter um volume `api_node_modules` antigo, recrie só esse volume para ele refletir o lockfile novo (o volume `postgres_data` pode ser preservado):

```bash
docker compose stop api worker
docker volume rm kiip-url-shortener-challenge_api_node_modules
docker compose up -d --build api worker
```

Serviços no host (portas padrão do `.env.example`):

| Serviço | URL / endereço |
|---------|----------------|
| API | http://localhost:3000 |
| Web | http://localhost:5173 |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| Worker | processo interno (sem porta publicada) |

Dentro da rede do Compose, os hostnames dos serviços são `api`, `web`, `postgres`, `redis` e `worker`.

### Interface web

- URL: http://localhost:5173 (porta `WEB_PORT`)
- Identidade visual: [docs/design/kiip-ui.md](docs/design/kiip-ui.md) (referência de princípios: [docs/design/design-reference.md](docs/design/design-reference.md) — **não** copiar identidade Coinbase)
- Fluxo: criar link → short URL + Copy → lista dos 50 mais recentes → View stats → Disable
- Endpoints consumidos: `POST /links`, `GET /links`, `GET /links/:slug/stats`, `PATCH /links/:slug`
- Env: `VITE_API_BASE_URL` (browser → API), `CORS_ORIGIN` (API → origem do Vite)

Testes do frontend (Vitest, lógica pura / client HTTP):

```bash
pnpm --filter web test
```

A API utiliza PostgreSQL via `DATABASE_URL` e Redis via `REDIS_URL`. No host (Prisma CLI / ferramentas locais), use `localhost`; no Compose, os hosts são `postgres` e `redis`.

`SHORT_URL_BASE_URL` é a base pública usada para montar `shortUrl` em `POST /links` e `GET /links` (ex.: `http://localhost:3000`). Não confundir com `API_PORT` / `PORT` (porta de listen). Sem trailing slash.

`VITE_API_BASE_URL` é a URL que o **browser** usa para chamar a API. Deve ser resolvível no host — **não** use `http://api:3000`. No Compose, se a variável estiver ausente, o default é `http://localhost:${API_PORT}`.

`CORS_ORIGIN` é a origem exata do frontend permitida pela API. No Compose, se a variável estiver ausente, o default é `http://localhost:${WEB_PORT}` (sem wildcard). Defina `CORS_ORIGIN` explicitamente só para sobrescrever.

### Redirect (`GET /:slug`)

Fluxo (ADR-002 / ADR-003):

1. **Cache-aside** `link:{slug}` no Redis (metadata: `id`, `destinationUrl`, `active`, `expiresAt`, `maxClicks` — **sem** `clickCount`).
2. Miss → PostgreSQL → popula cache (TTL `min(3600, expiresAt - now)` ou 3600; não cacheia link já expirado/inválido como válido).
3. Validação `active` / `expiresAt` → `410` se indisponível; slug inexistente → `404`.
4. **Unlimited** (`maxClicks` null): autoriza sem `UPDATE` síncrono; publica analytics best-effort; `302`.
5. **Capped**: autoridade exclusiva no PostgreSQL via `UPDATE` condicional atômico (`clickCount < maxClicks` + active/expiry). 1 row → `302` + evento `preCounted=true`; 0 rows → `410`. Falha de PG no gate → `5xx` (nunca fail-open).
6. Analytics: Redis Streams (`access_events`, group `analytics-workers`), `eventId` UUID UNIQUE, enqueue **non-blocking** por padrão (`ANALYTICS_ENQUEUE_TIMEOUT_MS=0`). Worker: `XREADGROUP` → TX idempotente → `XACK` só após `COMMIT`; reclaim via `XAUTOCLAIM`; poison → DLQ `access_events:dlq` após `ANALYTICS_MAX_ATTEMPTS` (default 5).

Delivery: at-least-once pós-aceite; dedup por `eventId`. Perda pré-aceite (Redis down no publish) é aceitável e **não** bloqueia o `302`. Cache Redis down → fallback PG. Worker down → stream acumula; redirect continua.

Detalhes: [ADR-002](docs/adr/002-maxclicks-postgresql-authority.md), [ADR-003](docs/adr/003-analytics-redis-streams.md).

Para desenvolver a API **fora** do Compose (Postgres já no ar), as migrations podem ser aplicadas no host:

```bash
pnpm --filter api exec prisma migrate deploy
pnpm --filter api exec prisma generate
```

---

## O problema

À primeira vista, um encurtador de URLs parece ser basicamente uma associação entre um código curto e uma URL de destino.

O desafio muda quando considero os requisitos de volume e comportamento:

- aproximadamente 100 milhões de redirecionamentos por mês;
- pico de 3.000 redirecionamentos por segundo;
- P95 abaixo de 50 ms no redirecionamento;
- aproximadamente 20 mil novos links por dia;
- um único link pode acumular mais de 10 milhões de acessos;
- cada acesso precisa ser registrado individualmente;
- falhas no registro de um acesso não podem impedir o redirecionamento;
- links podem expirar, ser desativados ou possuir limite de acessos;
- estatísticas precisam continuar rápidas mesmo para links muito acessados.

Por isso, estou tratando `GET /:slug` como o caminho crítico da aplicação.

Criar links é uma operação relativamente pouco frequente. Redirecioná-los é o cenário que concentra volume e sensibilidade à latência.

---

## Arquitetura inicial

A primeira versão será composta por:

- **React** no frontend;
- **NestJS** na API;
- **PostgreSQL + Prisma** para persistência;
- **Redis** para cache-aside de metadata de links, fila de analytics (Streams) e rate limiting de `POST /links` — **não** como autoridade de `maxClicks` (ver ADR-002);
- **processamento assíncrono** dos eventos de acesso;
- **Docker Compose** para subir o ambiente completo.

A intenção é manter a solução proporcional ao problema.

Não pretendo adicionar componentes de infraestrutura apenas para demonstrar escalabilidade. Se uma decisão puder ser resolvida de maneira mais simples dentro dos requisitos apresentados, vou preferir esse caminho.

A implementação local deve representar a arquitetura proposta sem exigir serviços externos para funcionar.

---

## Visão inicial do fluxo

De forma simplificada, penso na aplicação desta maneira:

    React
      |
      v
    NestJS
      |
      +------------------+
      |                  |
      v                  v
    Redis            PostgreSQL
      |
      |
      +------ evento de acesso
                  |
                  v
                Fila
                  |
                  v
                Worker
                  |
                  v
              PostgreSQL

O Redis não substitui o PostgreSQL como fonte de verdade.

Ele existe principalmente para retirar trabalho desnecessário do banco no caminho mais acessado da aplicação.

O processamento dos acessos fica separado do redirect para que a gravação das estatísticas não aumente a latência percebida pelo usuário.

---

## Redirecionamento

O fluxo inicial de `GET /:slug` é:

    GET /:slug
        |
        v
      NestJS
        |
        v
      Redis
        |
        +---- cache hit ----+
        |                   |
        | cache miss        |
        v                   |
    PostgreSQL              |
        |                   |
        +--> atualiza cache |
                            |
        +-------------------+
        |
        v
    valida o link
        |
        +-- inexistente ----------> 404
        |
        +-- inativo --------------> 410
        |
        +-- expirado -------------> 410
        |
        +-- maxClicks atingido ---> 410
        |
        v
    publica evento de acesso
        |
        v
      302 Found

A ideia do Redis aqui é principalmente evitar que links muito acessados façam a API consultar o PostgreSQL a cada redirecionamento.

Isso é especialmente relevante no caso de um link viral: o volume total do sistema pode ser administrável enquanto uma única chave concentra uma parcela grande dos acessos.

O PostgreSQL continua sendo a fonte persistente dos dados.

---

## Por que 302?

O redirecionamento será feito com `302 Found`.

Neste caso, não quero que o navegador trate a associação entre o slug e a URL de destino como um redirecionamento permanente.

Cada acesso precisa chegar novamente à aplicação porque ainda precisamos verificar:

- se o link continua ativo;
- se expirou;
- se atingiu `maxClicks`;
- e registrar aquele acesso.

Com um redirecionamento permanente cacheado pelo cliente, requisições futuras poderiam deixar de passar pela aplicação e, consequentemente, essas regras deixariam de ser avaliadas.

O `302` também é o comportamento definido pelo desafio.

---

## Registro dos acessos

Não quero colocar a persistência do acesso no caminho síncrono do redirect.

O fluxo pretendido é:

    request
       |
       v
    resolve link
       |
       +------> evento de acesso ------> fila ------> worker
       |
       v
      302

O usuário não precisa esperar um `INSERT` na tabela de acessos para ser redirecionado.

Além da questão de latência, isso atende uma regra importante do problema: uma falha no processamento das estatísticas não pode impedir o usuário de chegar à URL de destino.

O worker será responsável por consumir os eventos e persistir as informações necessárias no PostgreSQL.

**Mecanismo escolhido:** Redis Streams (`access_events`, consumer group `analytics-workers`) + worker Nest (`worker.main`). Enqueue no redirect é non-blocking por padrão; persistência idempotente por `eventId` UUID UNIQUE. Detalhes em ADR-003.

---

## Estatísticas

Um dos pontos que mais influencia a modelagem é a possibilidade de um único link possuir mais de 10 milhões de acessos.

Não quero que:

    GET /links/:slug/stats

precise percorrer ou agregar milhões de registros toda vez que for chamado.

A ideia inicial é separar três tipos de informação.

### `links`

Dados necessários para resolver e controlar o link.

Entre eles:

- slug;
- URL de destino;
- ativo/inativo;
- expiração;
- limite de acessos;
- contador total;
- data de criação.

### `access_events`

Histórico individual dos acessos.

Cada evento deve guardar pelo menos:

- link;
- data/hora;
- referer;
- user-agent.

Essa tabela atende tanto ao histórico individual exigido quanto à consulta dos últimos acessos.

Para buscar os últimos 20 registros sem percorrer todo o histórico, pretendo criar um índice considerando o link e a data do acesso.

Algo próximo de:

    (link_id, accessed_at DESC)

### `daily_link_stats`

Contadores agregados por link e por dia.

Em vez de calcular a série dos últimos sete dias percorrendo toda a tabela de eventos, a API poderá consultar diretamente esses contadores.

A intenção é que o custo do endpoint de estatísticas seja limitado independentemente de o link possuir mil ou 10 milhões de acessos.

De forma resumida:

    total de acessos
          |
          v
    links.click_count


    últimos 7 dias
          |
          v
    daily_link_stats


    últimos 20 acessos
          |
          v
    access_events
    + índice
    + LIMIT 20

### `GET /links` (suporte à UI)

Endpoint auxiliar para a listagem da interface web (o enunciado pede lista na UI; não exige este path na API). Leitura PostgreSQL apenas — **sem Redis**, sem paginação, sem query params.

```http
GET /links
```

```json
{
  "items": [
    {
      "slug": "abc123",
      "shortUrl": "http://localhost:3000/abc123",
      "url": "https://example.com",
      "active": true,
      "expiresAt": null,
      "maxClicks": null,
      "clickCount": 42,
      "createdAt": "2026-09-20T16:00:00.000Z"
    }
  ]
}
```

| Regra | Detalhe |
| --- | --- |
| Limite | **50** links mais recentes (`LIMIT 50`) |
| Ordenação | `createdAt DESC` |
| Vazio | `{ "items": [] }` |
| `clickCount` | `links.click_count` (**nunca** `COUNT(AccessEvent)`); mesma consistência eventual do stats |
| Estado | campos brutos (`active`, `expiresAt`, `maxClicks`, `clickCount`); a UI deriva inactive/expired/maxed |
| Índice | **sem** índice em `createdAt` nesta unidade — endpoint auxiliar; revisitável se a tabela crescer e o Seq Scan degradar a UI |

### `GET /links/:slug/stats` (implementado)

Leitura **somente PostgreSQL** (Redis não participa; sem cache de stats). Shape:

1. `Link` por `slug` UNIQUE → `totalClicks` = `Link.clickCount` (**nunca** `COUNT(AccessEvent)`);
2. após obter `linkId`, em paralelo (`Promise.all`):
   - `DailyLinkStat` onde `linkId` + `date` entre o início e o fim da janela UTC → série `last7Days`;
   - `AccessEvent` onde `linkId`, `ORDER BY accessedAt DESC LIMIT 20` → `recentAccesses`.

**Contrato de resposta:**

```json
{
  "slug": "abc123",
  "totalClicks": 42,
  "last7Days": [
    { "date": "2026-09-14", "clicks": 0 },
    { "date": "2026-09-15", "clicks": 3 }
  ],
  "recentAccesses": [
    {
      "accessedAt": "2026-09-19T10:00:00.000Z",
      "referer": null,
      "userAgent": "Mozilla/5.0"
    }
  ]
}
```

| Campo | Origem | Notas |
| --- | --- | --- |
| `totalClicks` | `links.click_count` | `number`; conversão BigInt com rejeição se `> Number.MAX_SAFE_INTEGER` |
| `last7Days` | `daily_link_stats` | **exatamente 7** entradas; **hoje UTC + 6 dias civis anteriores**; ordem **ASC**; dias ausentes **zero-fill na aplicação** |
| `recentAccesses` | `access_events` | até **20** mais recentes; `referer` / `userAgent` preservam `null` |

**Semântica de estado do link:** stats retornam **200** para links `disabled`, `expired` ou com `maxClicks` atingido. Somente slug inexistente → **404**.

**Consistência eventual (ADR-001):** o worker assíncrono pode deixar `clickCount` (especialmente capped / preCounted) temporariamente à frente de `daily_link_stats` / `access_events`. Isso **não é tratado como erro** e **não** é sincronizado artificialmente na leitura.

**Por que 10M+ eventos não tornam stats linear:** o total é um contador na linha do link; a série usa no máximo 7 linhas diárias (PK `(linkId, date)`); o histórico recente usa o índice `(linkId, accessedAt DESC)` com `LIMIT 20`. Nenhuma dessas queries faz full scan proporcional ao histórico.
---

## Cache e desativação

Adicionar cache cria outro problema que precisa ser tratado explicitamente.

Se um link estiver armazenado no Redis e for desativado no PostgreSQL, não posso esperar o TTL do cache expirar para que a alteração tenha efeito.

O requisito é que a desativação seja percebida imediatamente.

### `PATCH /links/:slug` (somente disable)

Body aceito: `{ "active": false }`. Sem reativação e sem editar `url` / `expiresAt` / `maxClicks`.

| Caso | Resposta |
|------|----------|
| Sucesso (1ª vez ou retry idempotente) | **204 No Content** |
| Slug inexistente | **404** |
| `active: true` / campos extras / body inválido | **400** |
| Redis falha no `DEL` após PG `active=false` | **503** (PG permanece `false`; **sem** compensação) |

Fluxo:

```text
UPDATE links SET active=false WHERE slug=? AND active=true
DEL link:{slug}   # obrigatório antes do 204
```

- Disable é **monotônico** (`true → false` apenas). Nunca se escreve `active=true` de volta.
- `PATCH 204` implica: PG disabled **e** a stale key foi removida → novos `GET /:slug` observam **410**.
- `PATCH 503` **não** promete invalidação imediata; o retry do mesmo PATCH tenta `DEL` de novo e, com sucesso, retorna **204**.
- GETs já em voo durante o PATCH podem ainda completar com 302.
- TTL do cache **não** é mecanismo de correctness para disable.
- Contrato de resposta de `POST /links` **não** muda (sem campo `active` no create).

---

## `maxClicks` e concorrência

Esse é um dos pontos que quero validar com mais cuidado durante a implementação.

Considere:

    maxClicks = 100
    clickCount = 99

e duas requisições chegando praticamente ao mesmo tempo:

    Request A ----+
                  |
                  +----> clickCount = 99
                  |
    Request B ----+

Não posso simplesmente fazer:

    lê contador
    verifica limite
    incrementa contador

nas duas requisições de forma independente.

As duas poderiam ler `99` antes que qualquer uma delas atualizasse o valor e ambas seriam autorizadas.

A solução precisa garantir atomicidade nessa operação.

**Decisão final (ADR-002):** links capped usam um `UPDATE` condicional atômico no **PostgreSQL** como única autoridade (`clickCount < maxClicks` + `active` + `expiresAt`). Redis guarda só metadata de cache — não é autoridade de enforcement. Links unlimited não fazem esse write no hot path; o worker incrementa `clickCount` após o evento (ADR-003).

Ver [ADR-002](docs/adr/002-maxclicks-postgresql-authority.md).

---

## Slugs

Slugs personalizados usam o charset Base62 (`0-9`, `A-Z`, `a-z`), length 1–64, case-sensitive. O valor `links` é rejeitado para não conflitar com rotas `/links/*` quando `GET /:slug` existir. Tentativa de reutilizar um slug existente falha com `409` sem sobrescrever o link anterior — a constraint `UNIQUE` do PostgreSQL é a autoridade final.

### Geração automática

Quando `slug` não é informado, a API gera um slug Base62 de **8** caracteres com `crypto.randomInt` (sem `Math.random`), faz `INSERT` e, em colisão `UNIQUE`, regenera e tenta de novo (máximo **5** tentativas).

Espaço: \(62^8 \approx 2{,}18 \times 10^{14}\).

O argumento relevante para o retry não é a probabilidade acumulada estilo birthday problem sobre todo o histórico, e sim a chance de uma **nova** geração cair em um slug já ocupado:

\[
p \approx \frac{n}{N}
\]

Com ~73M links (~10 anos a ~20k/dia): \(p \approx 73 \times 10^6 / 2{,}18 \times 10^{14} \approx 3{,}3 \times 10^{-7}\) — cerca de uma colisão a cada ~3 milhões de novas tentativas nesse nível de ocupação. Com `UNIQUE` + retry, length 8 permanece adequado.

Unicidade continua garantida pelo PostgreSQL em todos os casos. Se as 5 tentativas de geração automática esgotarem (extremamente improvável na escala do desafio), a API responde `503`.

---

## Rate limiting

Somente **`POST /links`** é limitado por IP. **`GET /:slug` não** entra no limiter.

- Algoritmo: **fixed window** no Redis.
- Key: `rl:post-links:{ip}` com TTL = janela (sem keys permanentes).
- Atomicidade: script Lua em **uma** ida ao Redis — `INCR`; se primeira ocorrência, `EXPIRE`; retorna `{count, ttl}` para allow/deny e `Retry-After`.
- Excedeu → **429** `{ statusCode: 429, message: "rate limit exceeded" }` + header **`Retry-After`** (segundos restantes da janela).
- Redis indisponível → **fail-open** (criação segue; log `rate_limit_unavailable`). Rate limit é proteção, não fonte de verdade dos links.
- IP: `req.ip`. `TRUST_PROXY` só se configurado explicitamente (`true`/`1` ou hops); sem isso não se confia em `X-Forwarded-For`.

| Env | Default |
|-----|---------|
| `RATE_LIMIT_POST_LINKS_MAX` | `30` |
| `RATE_LIMIT_POST_LINKS_WINDOW_SECONDS` | `60` |
| `TRUST_PROXY` | unset / false |

---

## Estrutura esperada do projeto

A estrutura exata ainda pode mudar, mas a intenção inicial é manter frontend e backend no mesmo repositório.

Algo próximo de:

    .
    ├── apps/
    │   ├── api/
    │   └── web/
    │
    ├── packages/
    │
    ├── docs/
    │
    ├── docker-compose.yml
    ├── .env.example
    └── README.md

Também pretendo separar o processamento de analytics da API, mesmo que API e worker possam compartilhar tipos e outras partes do projeto.

---

## Testes

Os testes vão se concentrar principalmente nas regras que podem quebrar o comportamento do redirect.

Entre os cenários que pretendo cobrir:

- criação de link;
- validação da URL;
- geração automática de slug;
- conflito de slug personalizado;
- slug inexistente;
- link desativado;
- link expirado;
- `maxClicks`;
- concorrência no limite de acessos;
- redirect `302`;
- cache hit;
- cache miss;
- invalidação do cache;
- processamento assíncrono dos eventos;
- consulta das estatísticas.

Também haverá pelo menos um fluxo de integração/E2E cobrindo o redirecionamento completo.

No final do desenvolvimento, quero validar a aplicação partindo de um ambiente limpo para garantir que dependências, banco e migrations sejam configurados a partir das instruções do repositório.

O objetivo é que a solução possa ser iniciada com:

    docker compose up

---

## O que não pretendo fazer

Algumas coisas fariam sentido em uma infraestrutura de produção maior, mas não considero necessárias para esta entrega:

- Kubernetes;
- infraestrutura em cloud;
- múltiplas réplicas da API;
- cluster de PostgreSQL;
- cluster de Redis;
- CDN;
- autenticação;
- CI/CD;
- arquitetura de microserviços.

A aplicação será pensada para não impedir uma evolução futura nessa direção, mas não quero implementar complexidade que o desafio não pede.

Se fosse necessário evoluir essa arquitetura para um ambiente de produção com outra ordem de grandeza, alguns caminhos naturais seriam:

    API stateless
        |
        v
    Load Balancer
        |
        v
    múltiplas instâncias


    PostgreSQL
        |
        +--> HA / replicas


    Redis
        |
        +--> HA / cluster


    processamento assíncrono
        |
        +--> broker durável

Esses componentes fazem parte da discussão de evolução da arquitetura, não do escopo da implementação atual.

---

## Uso de IA

Estou utilizando IA (Cursor / agentes especializados no repositório) como ferramenta de apoio à engenharia durante o desafio — não como substituto de revisão ou responsabilidade humana.

A IA apoiou:

- discussão e documentação de arquitetura (ADRs, modelagem, trade-offs);
- implementação e ajustes de código (API e frontend);
- derivação e revisão de testes;
- revisão de alterações (contratos, índices, UX);
- documentação (README, design Kiip).

Decisões relevantes foram revisadas antes ou durante a implementação; código gerado ou alterado precisa ser compreendido; testes verdes não são tratados isoladamente como prova de correção; commits são feitos manualmente após revisão humana. A responsabilidade pelas decisões e pelo código permanece humana.

Um exemplo inicial foi a discussão sobre `maxClicks`: uma implementação simples baseada em leitura e incremento poderia passar em testes básicos e ainda falhar com requisições concorrentes. Outro ponto foi a relação entre cache e desativação imediata dos links — Redis melhora a leitura, mas exige invalidação quando a alteração precisa ter efeito imediato. No frontend, a listagem via `GET /links` (em vez de inventário só no cliente) foi a decisão para manter o backend como autoridade.

As decisões descritas neste documento e em `docs/` são as que escolhi seguir depois dessa análise; preciso conseguir justificar os trade-offs de cada uma delas.

### Compound Engineering

Para não reconstruir o mesmo contexto a cada prompt, decisões e aprendizados relevantes ficam persistidos como documentação de arquitetura, ADRs, project rules e agents especializados. O objetivo é reutilizar contexto entre unidades de trabalho, não acumular arquivos por quantidade.

#### Fontes de verdade

| Camada | Papel |
|--------|--------|
| `README.MD` | requisitos, execução e visão do projeto |
| `docs/architecture/` | arquitetura implementada |
| `docs/adr/` | decisões arquiteturais e trade-offs |
| `docs/design/kiip-ui.md` | UI real (cores, tipografia, componentes) |
| `docs/design/design-reference.md` | referência de princípios visuais apenas |
| `.cursor/rules/` | guardrails de implementação |
| `.cursor/agents/` | especialistas de análise |

Não duplicar decisões entre essas camadas: rules e agents apontam para a documentação; não a reescrevem.

#### Estrutura

```text
.cursor/
├── rules/
│   ├── 00-project.mdc
│   ├── backend.mdc
│   └── frontend.mdc
└── agents/
    ├── architect.md
    ├── database.md
    ├── testing.md
    └── reviewer.md
```

**Rules** — guardrails aplicados durante o desenvolvimento:

- `00-project` — escopo, fontes de verdade, dependências, documentação e Git;
- `backend` — NestJS, TypeScript, API, Prisma/PostgreSQL, concorrência e performance;
- `frontend` — React, TypeScript, integração com API, UX e acessibilidade.

**Agents** — especialistas sob demanda:

- `architect` — alternativas e trade-offs antes de decisões arquiteturais relevantes;
- `database` — modelagem, queries, índices, migrations, integridade e concorrência;
- `testing` — cenários derivados dos requisitos e gaps independentemente da implementação;
- `reviewer` — confronta implementação, requisitos, documentação e testes antes do commit.

#### Fluxo

```text
Requirement
  → Context
  → Plan
  → Architecture / Data review (quando necessário)
  → Implementation
  → Testing
  → Technical review
  → Human review
  → Manual commit
```

Nem todo agent participa de toda alteração. Exemplos: decisão arquitetural relevante → `architect`; mudança sensível de persistência → `database`; nova regra de negócio → `testing`; unidade concluída → `reviewer`. Especialização só quando agrega valor.

---

# Plano de execução

Antes de começar a implementação, dividi o desafio em etapas para evitar tentar resolver todos os problemas ao mesmo tempo.

A prioridade é fechar primeiro a fundação e o caminho crítico do backend. O frontend entra depois que os contratos principais da API estiverem funcionando.

## Sexta-feira — 18/09 — Fundação e arquitetura

Objetivo: terminar o dia com o problema entendido e a base do projeto definida, sem antecipar a implementação.

- [x] leitura completa do desafio;
- [x] levantamento dos requisitos funcionais e não funcionais;
- [x] identificação do redirect como caminho crítico;
- [x] estimativas de volume e análise dos pontos de escala;
- [x] definição inicial da arquitetura;
- [x] decisão inicial de uso de PostgreSQL, Redis e processamento assíncrono;
- [x] definição inicial da estratégia de cache;
- [x] análise do problema de concorrência em `maxClicks`;
- [x] definição da estratégia inicial para estatísticas com grande volume de acessos;
- [x] desenho do System Design;
- [x] criação do repositório;
- [x] documentação das decisões iniciais.

Ao final desta etapa, quero ter clareza sobre o que será construído e, principalmente, por que cada componente existe.

---

## Sábado — 19/09 — Backend e caminho crítico

Objetivo: terminar o dia com o núcleo funcional da aplicação funcionando.

### Fundação

- [x] criar a estrutura do monorepo;
- [x] configurar NestJS;
- [x] configurar PostgreSQL;
- [x] configurar Prisma;
- [x] configurar Redis;
- [x] criar o Docker Compose;
- [x] configurar variáveis de ambiente e `.env.example`;
- [x] criar e validar as migrations iniciais.

### Links

- [x] implementar `POST /links`;
- [x] validar URL de destino;
- [x] implementar slug personalizado;
- [x] definir e implementar a geração automática de slug;
- [x] garantir unicidade no banco;
- [x] implementar `expiresAt`;
- [x] implementar `maxClicks`;
- [x] implementar rate limiting por IP.

### Redirect

- [x] implementar `GET /:slug`;
- [x] retornar `404` para links inexistentes;
- [x] retornar `410` para links indisponíveis;
- [x] implementar redirect `302`;
- [x] implementar cache-aside com Redis;
- [x] tratar cache hit e cache miss;
- [x] implementar invalidação de cache;
- [x] tratar concorrência relacionada a `maxClicks`.

### Analytics

- [x] definir o mecanismo da fila;
- [x] publicar eventos de acesso sem bloquear o redirect;
- [x] criar o worker;
- [x] persistir os acessos individuais;
- [x] atualizar o contador total;
- [x] atualizar as agregações diárias;
- [x] garantir que falhas no processamento de analytics não impeçam o redirect.

A principal meta do sábado é conseguir executar o seguinte fluxo:

    criar link
        |
        v
    receber slug
        |
        v
    acessar slug
        |
        v
    resolver pelo cache/banco
        |
        v
    validar regras
        |
        v
    publicar evento
        |
        +-------------> worker
        |
        v
    retornar 302

Se esse caminho estiver sólido, o restante da aplicação passa a trabalhar sobre uma base funcional.

---

## Domingo — 20/09 — Estatísticas, frontend e testes

Objetivo: transformar o backend funcional em uma entrega completa.

### Estatísticas

- [x] implementar `GET /links/:slug/stats`;
- [x] retornar total de acessos;
- [x] retornar série diária dos últimos sete dias;
- [x] retornar os últimos 20 acessos;
- [x] validar os índices utilizados pelas consultas;
- [x] garantir que as consultas não dependam de percorrer todo o histórico.

### Alteração de links

- [x] implementar `PATCH /links/:slug`;
- [x] permitir desativação;
- [x] invalidar imediatamente o cache correspondente;
- [x] validar o comportamento do redirect após a alteração.

### Frontend

- [x] criar a aplicação React;
- [x] implementar formulário de criação de links;
- [x] listar links criados;
- [x] exibir total de acessos;
- [x] criar visualização das estatísticas;
- [x] tratar estados de loading e erro;
- [x] manter a interface simples, priorizando funcionalidade.

### Testes

- [x] criação de link;
- [x] URL inválida;
- [x] slug personalizado duplicado;
- [x] expiração;
- [x] desativação;
- [x] `maxClicks`;
- [x] concorrência no limite de acessos;
- [x] redirect `302`;
- [x] cache hit;
- [x] cache miss;
- [x] invalidação de cache;
- [x] processamento dos eventos de acesso;
- [x] estatísticas;
- [x] pelo menos um fluxo E2E completo de redirecionamento.

### Documentação

- [ ] revisar este README;
- [ ] atualizar decisões que tenham mudado durante a implementação;
- [x] documentar a estratégia final de geração de slugs;
- [x] documentar a solução final para `maxClicks`;
- [x] documentar o mecanismo escolhido para processamento assíncrono;
- [x] atualizar a seção de uso de IA;
- [ ] adicionar o System Design final;
- [x] documentar como executar a aplicação;
- [x] documentar como executar os testes.

---

## Segunda-feira — 21/09 — Validação e entrega

A segunda-feira fica reservada para revisão e envio, e não para implementação planejada de novas funcionalidades.

A validação final será feita simulando o ambiente de quem receberá o projeto.

A ideia é partir de um clone limpo do repositório e verificar se apenas as instruções documentadas são suficientes para executar a aplicação.

### Checklist final

- [ ] clonar o repositório em um diretório limpo;
- [ ] configurar as variáveis de ambiente conforme `.env.example`;
- [ ] executar `docker compose up`;
- [ ] confirmar que as migrations são aplicadas corretamente;
- [ ] confirmar que frontend, API, PostgreSQL, Redis e worker iniciam;
- [ ] criar um link pela interface;
- [ ] acessar o link curto;
- [ ] confirmar o redirect `302`;
- [ ] confirmar o registro do acesso;
- [ ] consultar as estatísticas;
- [ ] desativar o link;
- [ ] confirmar que o próximo acesso retorna `410`;
- [ ] executar toda a suíte de testes;
- [ ] verificar se nenhum secret foi commitado;
- [ ] revisar o histórico de commits;
- [ ] revisar o README;
- [ ] revisar o System Design;
- [ ] conferir se consigo justificar as decisões implementadas.

Somente depois dessa validação o repositório será compartilhado para avaliação.

---

## Critério para corte de escopo

Se o cronograma ficar apertado, vou priorizar na seguinte ordem:

1. aplicação subindo corretamente com Docker Compose;
2. regras de negócio do backend;
3. redirect e seus casos de erro;
4. testes automatizados;
5. registro assíncrono dos acessos;
6. endpoint de estatísticas;
7. frontend funcional;
8. melhorias visuais e refinamentos.

Não pretendo sacrificar corretude ou testes para adicionar infraestrutura ou acabamento que não façam parte dos critérios principais do desafio.