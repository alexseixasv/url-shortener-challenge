# URL Shortener

A URL shortener with access statistics.

Before implementation, I wrote down how I read the problem, the points I consider most critical, and the initial architecture decisions.

> **Current status:** backend complete (`POST/GET/PATCH` links, redirect, stats, Redis Streams analytics, rate limit) and a **React frontend** in `apps/web` (create / list / stats / disable). System design: [docs/architecture/system-design.md](docs/architecture/system-design.md).

---

## Local environment

With Docker installed:

```bash
cp .env.example .env
docker compose up --build
```

This starts PostgreSQL, Redis, the API, the **worker**, and the web app. The API and the worker wait until Postgres and Redis are healthy, apply the versioned migrations with `prisma migrate deploy`, and only then start. You do not need to enter the container for `pnpm install`, `migrate`, consumer-group creation, or `db push`.

`prisma generate` runs at **image build** time (Dockerfile), not on every restart.

If you change `apps/api/package.json` after an old `api_node_modules` volume already exists, recreate only that volume so it matches the new lockfile (the `postgres_data` volume can stay):

```bash
docker compose stop api worker
docker volume ls
docker volume rm <compose-project>_api_node_modules
docker compose up -d --build api worker
```

`<compose-project>` is the Compose project name (by default, the directory name). Remove only the volume that ends in `_api_node_modules`.

Services on the host (default ports from `.env.example`):

| Service | URL / address |
|---------|----------------|
| API | http://localhost:3000 |
| Web | http://localhost:5173 |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| Worker | internal process (no published port) |

Inside the Compose network, service hostnames are `api`, `web`, `postgres`, `redis`, and `worker`.

### Web UI

- URL: http://localhost:5173 (port `WEB_PORT`)
- Visual identity: [docs/design/ui.md](docs/design/ui.md)
- Flow: create link → short URL + Copy → list of the 50 most recent → View stats → Disable
- Endpoints used: `POST /links`, `GET /links`, `GET /links/:slug/stats`, `PATCH /links/:slug`
- Env: `VITE_API_BASE_URL` (browser → API), `CORS_ORIGIN` (API → Vite origin)

Frontend tests (Vitest, pure logic / HTTP client):

```bash
pnpm --filter web test
```

The API uses PostgreSQL via `DATABASE_URL` and Redis via `REDIS_URL`. On the host (Prisma CLI / local tools), use `localhost`; in Compose, the hosts are `postgres` and `redis`.

`SHORT_URL_BASE_URL` is the public base used to build `shortUrl` on `POST /links` and `GET /links` (example: `http://localhost:3000`). Do not confuse it with `API_PORT` / `PORT` (listen port). No trailing slash.

`VITE_API_BASE_URL` is the URL the **browser** uses to call the API. It must resolve on the host — do not use `http://api:3000`. In Compose, if the variable is absent, the default is `http://localhost:${API_PORT}`.

`CORS_ORIGIN` is the exact frontend origin allowed by the API. In Compose, if the variable is absent, the default is `http://localhost:${WEB_PORT}` (no wildcard). Set `CORS_ORIGIN` explicitly only to override.

### Redirect (`GET /:slug`)

Flow (ADR-002 / ADR-003):

1. **Cache-aside** `link:{slug}` in Redis (metadata: `id`, `destinationUrl`, `active`, `expiresAt`, `maxClicks` — **without** `clickCount`).
2. Miss → PostgreSQL → populate cache (TTL `min(3600, expiresAt - now)` or 3600; do not cache an already expired/invalid link as valid).
3. Validate `active` / `expiresAt` → `410` if unavailable; missing slug → `404`.
4. **Unlimited** (`maxClicks` null): authorize without a synchronous `UPDATE`; publish analytics best-effort; `302`.
5. **Capped**: exclusive authority in PostgreSQL via an atomic conditional `UPDATE` (`clickCount < maxClicks` + active/expiry). 1 row → `302` + event `preCounted=true`; 0 rows → `410`. PostgreSQL failure on the gate → `5xx` (never fail-open).
6. Analytics: Redis Streams (`access_events`, group `analytics-workers`), `eventId` UUID UNIQUE, enqueue **non-blocking** by default (`ANALYTICS_ENQUEUE_TIMEOUT_MS=0`). Worker: `XREADGROUP` → idempotent TX → `XACK` only after `COMMIT`; reclaim via `XAUTOCLAIM`; poison → DLQ `access_events:dlq` after `ANALYTICS_MAX_ATTEMPTS` (default 5).

Delivery: at-least-once after acceptance; dedup by `eventId`. Pre-acceptance loss (Redis down on publish) is acceptable and **does not** block the `302`. Redis cache down → PostgreSQL fallback. Worker down → the stream accumulates; redirects continue.

Details: [ADR-002](docs/adr/002-maxclicks-postgresql-authority.md), [ADR-003](docs/adr/003-analytics-redis-streams.md).

To develop the API **outside** Compose (Postgres already running), migrations can be applied on the host:

```bash
pnpm --filter api exec prisma migrate deploy
pnpm --filter api exec prisma generate
```

---

## The problem

At first glance, a URL shortener looks like a mapping from a short code to a destination URL.

The problem changes with the volume and behavior requirements:

- about 100 million redirects per month;
- a peak of 3,000 redirects per second;
- P95 under 50 ms on redirect;
- about 20 thousand new links per day;
- a single link can accumulate more than 10 million accesses;
- each access must be recorded individually;
- a failure while recording an access must not block the redirect;
- links can expire, be disabled, or have a click limit;
- statistics must stay fast even for heavily used links.

That is why I treat `GET /:slug` as the critical path.

Creating links is relatively infrequent. Redirecting them is where volume and latency sensitivity concentrate.

---

## Architecture

The application is made of:

- **React** on the frontend (`apps/web`);
- **NestJS** on the API (`apps/api`);
- **PostgreSQL + Prisma** for persistence;
- **Redis** for link-metadata cache-aside, the analytics queue (Streams), and `POST /links` rate limiting — **not** as the `maxClicks` authority (see ADR-002);
- a separate Nest **worker** that processes access events;
- **Docker Compose** to start the full environment.

The solution stays proportional to the problem: no infrastructure added only to demonstrate scale. Consolidated detail is in [docs/architecture/system-design.md](docs/architecture/system-design.md).

---

## Flow

Simplified:

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
      +------ access event
                  |
                  v
                Queue
                  |
                  v
                Worker
                  |
                  v
              PostgreSQL

Redis does not replace PostgreSQL as the source of truth.

It exists mainly to take unnecessary work off the database on the hottest path.

Access processing stays off the redirect so writing statistics does not increase the latency the user feels.

---

## Redirect

The `GET /:slug` flow is:

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
        +--> update cache   |
                            |
        +-------------------+
        |
        v
    validate the link
        |
        +-- missing --------------> 404
        |
        +-- inactive -------------> 410
        |
        +-- expired --------------> 410
        |
        +-- maxClicks reached ----> 410
        |
        v
    publish access event
        |
        v
      302 Found

Redis is here mainly so very hot links do not make the API hit PostgreSQL on every redirect.

That matters for a viral link: total system volume can stay manageable while a single key concentrates a large share of the traffic.

PostgreSQL remains the persistent source of the data.

---

## Why 302?

Redirects use `302 Found`.

I do not want the browser to treat the slug-to-destination association as a permanent redirect.

Every access must reach the application again because we still need to check:

- whether the link is still active;
- whether it expired;
- whether it reached `maxClicks`;
- and to record that access.

With a permanent redirect cached by the client, later requests could skip the application, and those rules would stop being evaluated.

`302` is also the required behavior.

---

## Recording accesses

I do not want access persistence on the synchronous redirect path.

The intended flow is:

    request
       |
       v
    resolve link
       |
       +------> access event ------> queue ------> worker
       |
       v
      302

The user does not wait for an `INSERT` into the access table before being redirected.

Besides latency, this matches an important rule: a failure while processing statistics must not stop the user from reaching the destination URL.

The worker consumes the events and persists what PostgreSQL needs.

**Chosen mechanism:** Redis Streams (`access_events`, consumer group `analytics-workers`) + Nest worker (`worker.main`). Enqueue on redirect is non-blocking by default; persistence is idempotent via `eventId` UUID UNIQUE. Details in ADR-003.

---

## Statistics

One of the strongest modeling constraints is that a single link can have more than 10 million accesses.

I do not want:

    GET /links/:slug/stats

to scan or aggregate millions of rows on every call.

The model separates three kinds of information.

### `links`

Data needed to resolve and control the link.

Including:

- slug;
- destination URL;
- active/inactive;
- expiration;
- click limit;
- total counter;
- creation time.

### `access_events`

Individual access history.

Each event stores at least:

- link;
- timestamp;
- referer;
- user-agent.

This table serves both the required individual history and the recent-access query.

To fetch the last 20 rows without scanning the whole history, there is an index on:

    (link_id, accessed_at DESC)

### `daily_link_stats`

Aggregated counters per link and per day.

Instead of computing the last seven days by scanning the event table, the API reads these counters directly.

The goal is a bounded stats-endpoint cost whether the link has a thousand accesses or 10 million.

In short:

    lifetime total
          |
          v
    links.click_count


    last 7 days
          |
          v
    daily_link_stats


    last 20 accesses
          |
          v
    access_events
    + index
    + LIMIT 20

### `GET /links` (UI support)

Auxiliary endpoint for the web list (the UI needs a list; this path is not a separate product requirement beyond that). PostgreSQL read only — **no Redis**, no pagination, no query params.

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

| Rule | Detail |
| --- | --- |
| Limit | **50** most recent links (`LIMIT 50`) |
| Order | `createdAt DESC` |
| Empty | `{ "items": [] }` |
| `clickCount` | `links.click_count` (**never** `COUNT(AccessEvent)`); same eventual consistency as stats |
| State | raw fields (`active`, `expiresAt`, `maxClicks`, `clickCount`); the UI derives inactive/expired/maxed |
| Index | **no** `createdAt` index in this unit — auxiliary endpoint; revisit if the table grows and the Seq Scan hurts the UI |

### `GET /links/:slug/stats` (implemented)

**PostgreSQL-only** read (Redis does not participate; no stats cache). Shape:

1. `Link` by UNIQUE `slug` → `totalClicks` = `Link.clickCount` (**never** `COUNT(AccessEvent)`);
2. after `linkId`, in parallel (`Promise.all`):
   - `DailyLinkStat` where `linkId` + `date` is inside the UTC window → `last7Days`;
   - `AccessEvent` where `linkId`, `ORDER BY accessedAt DESC LIMIT 20` → `recentAccesses`.

**Response contract:**

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

| Field | Source | Notes |
| --- | --- | --- |
| `totalClicks` | `links.click_count` | `number`; BigInt conversion rejects values `> Number.MAX_SAFE_INTEGER` |
| `last7Days` | `daily_link_stats` | **exactly 7** entries; **today UTC + the 6 previous civil days**; **ASC** order; missing days are **zero-filled in the application** |
| `recentAccesses` | `access_events` | up to the **20** most recent; `referer` / `userAgent` keep `null` |

**Link state:** stats return **200** for `disabled`, `expired`, or `maxClicks`-reached links. Only a missing slug → **404**.

**Eventual consistency (ADR-001):** the async worker can leave `clickCount` (especially capped / preCounted) temporarily ahead of `daily_link_stats` / `access_events`. That is **not treated as an error** and is **not** artificially synchronized on read.

**Why 10M+ events do not make stats linear:** the total is a counter on the link row; the series uses at most 7 daily rows (PK `(linkId, date)`); recent history uses the `(linkId, accessedAt DESC)` index with `LIMIT 20`. None of these queries full-scans in proportion to history.

---

## Cache and disable

Adding a cache creates a problem that has to be handled explicitly.

If a link is stored in Redis and then disabled in PostgreSQL, I cannot wait for the cache TTL to expire before the change takes effect.

Disable must be observed immediately.

### `PATCH /links/:slug` (disable only)

Accepted body: `{ "active": false }`. No re-enable and no edits to `url` / `expiresAt` / `maxClicks`.

| Case | Response |
|------|----------|
| Success (first time or idempotent retry) | **204 No Content** |
| Missing slug | **404** |
| `active: true` / extra fields / invalid body | **400** |
| Redis `DEL` fails after PG `active=false` | **503** (PG stays `false`; **no** compensation) |

Flow:

```text
UPDATE links SET active=false WHERE slug=? AND active=true
DEL link:{slug}   # required before 204
```

- Disable is **monotonic** (`true → false` only). `active=true` is never written back.
- `PATCH 204` means: PostgreSQL disabled **and** the stale key was removed → later `GET /:slug` observe **410**.
- `PATCH 503` does **not** promise immediate invalidation; retrying the same PATCH tries `DEL` again and, on success, returns **204**.
- GETs already in flight during the PATCH may still complete with 302.
- Cache TTL is **not** the correctness mechanism for disable.
- The `POST /links` response contract does **not** change (no `active` field on create).

---

## `maxClicks` and concurrency

This is one of the points I wanted to validate carefully.

Consider:

    maxClicks = 100
    clickCount = 99

and two requests arriving at almost the same time:

    Request A ----+
                  |
                  +----> clickCount = 99
                  |
    Request B ----+

I cannot simply:

    read counter
    check limit
    increment counter

independently on both requests.

Both could read `99` before either update landed, and both would be authorized.

The operation needs atomicity.

**Final decision (ADR-002):** capped links use an atomic conditional `UPDATE` in **PostgreSQL** as the only authority (`clickCount < maxClicks` + `active` + `expiresAt`). Redis stores cache metadata only — it is not the enforcement authority. Unlimited links do not do that write on the hot path; the worker increments `clickCount` after the event (ADR-003).

See [ADR-002](docs/adr/002-maxclicks-postgresql-authority.md).

---

## Slugs

Custom slugs use the Base62 charset (`0-9`, `A-Z`, `a-z`), length 1–64, case-sensitive. The value `links` is rejected so it does not collide with `/links/*`. Reusing an existing slug fails with `409` and does not overwrite the previous link — the PostgreSQL `UNIQUE` constraint is the final authority.

### Automatic generation

When `slug` is omitted, the API generates an **8**-character Base62 slug with `crypto.randomInt` (not `Math.random`), `INSERT`s, and on a `UNIQUE` collision regenerates and retries (maximum **5** attempts).

Space: \(62^8 \approx 2.18 \times 10^{14}\).

The relevant retry argument is not the accumulated birthday-problem probability over the whole history. It is the chance that a **new** generation lands on an already taken slug:

\[
p \approx \frac{n}{N}
\]

With ~73M links (~10 years at ~20k/day): \(p \approx 73 \times 10^6 / 2.18 \times 10^{14} \approx 3.3 \times 10^{-7}\) — about one collision every ~3 million new attempts at that occupancy. With `UNIQUE` + retry, length 8 stays adequate.

Uniqueness is still guaranteed by PostgreSQL in every case. If all 5 automatic attempts are exhausted (extremely unlikely at this scale), the API returns `503`.

---

## Rate limiting

Only **`POST /links`** is limited by IP. **`GET /:slug` is not** in the limiter.

- Algorithm: **fixed window** in Redis.
- Key: `rl:post-links:{ip}` with TTL = window (no permanent keys).
- Atomicity: one Lua script, **one** Redis round trip — `INCR`; on the first hit, `EXPIRE`; returns `{count, ttl}` for allow/deny and `Retry-After`.
- Over the limit → **429** `{ statusCode: 429, message: "rate limit exceeded" }` + **`Retry-After`** header (seconds left in the window).
- Redis unavailable → **fail-open** (create continues; log `rate_limit_unavailable`). Rate limiting is protection, not the source of truth for links.
- IP: `req.ip`. `TRUST_PROXY` only when set explicitly (`true`/`1` or hop count); otherwise `X-Forwarded-For` is not trusted.

| Env | Default |
|-----|---------|
| `RATE_LIMIT_POST_LINKS_MAX` | `30` |
| `RATE_LIMIT_POST_LINKS_WINDOW_SECONDS` | `60` |
| `TRUST_PROXY` | unset / false |

---

## Project structure

Monorepo with frontend and backend in the same repository; analytics in a separate worker process (same `apps/api` package, entry `worker.main`):

    .
    ├── apps/
    │   ├── api/
    │   └── web/
    │
    ├── docs/
    │   ├── adr/
    │   ├── architecture/
    │   └── design/
    │
    ├── docker-compose.yml
    ├── .env.example
    └── README.MD

---

## Tests

Tests focus on the rules that can break redirect behavior.

Covered scenarios include:

- link creation;
- URL validation;
- automatic slug generation;
- custom slug conflict;
- missing slug;
- disabled link;
- expired link;
- `maxClicks`;
- concurrency at the click limit;
- `302` redirect;
- cache hit;
- cache miss;
- cache invalidation;
- asynchronous event processing;
- statistics queries.

Integration/E2E flows cover the full redirect. The API `test:e2e` command is separate: it is not included by the root `test` script (`pnpm test` / `pnpm -r run test`) or by the API `pnpm test`.

Application validation starts from a clean environment so dependencies, database, and migrations come from the repository instructions.

The goal is to start with:

    docker compose up

### Validation with Docker Compose

With the stack up (`docker compose up --build`):

```bash
docker compose exec api pnpm test
docker compose exec api pnpm test:e2e
docker compose exec web pnpm test

docker compose exec api pnpm lint
docker compose exec web pnpm lint

docker compose exec api pnpm build
docker compose exec web pnpm build
```

---

## Out of scope

Some of these make sense in a larger production setup. They are not part of this delivery:

- Kubernetes;
- cloud infrastructure;
- multiple API replicas;
- a PostgreSQL cluster;
- a Redis cluster;
- a CDN;
- authentication;
- CI/CD;
- a microservice architecture.

The application is shaped so those can be added later, without implementing complexity this project does not need.

If this architecture had to grow by another order of magnitude, natural next steps would be:

    stateless API
        |
        v
    Load Balancer
        |
        v
    multiple instances


    PostgreSQL
        |
        +--> HA / replicas


    Redis
        |
        +--> HA / cluster


    asynchronous processing
        |
        +--> durable broker

Those components belong to the evolution discussion, not to the current implementation.

---

## Use of AI

I used AI (Cursor / specialized agents in the repository) as an engineering aid — not as a substitute for review or human responsibility.

AI helped with:

- architecture discussion and documentation (ADRs, modeling, trade-offs);
- implementation and code changes (API and frontend);
- test derivation and review;
- change review (contracts, indexes, UX);
- documentation (README, UI design).

Relevant decisions were reviewed before or during implementation; generated or changed code has to be understood; green tests are not treated, by themselves, as proof of correctness; commits are made manually after human review. Responsibility for the decisions and the code stays human.

An early example was `maxClicks`: a simple read-then-increment could pass basic tests and still fail under concurrent requests. Another was cache versus immediate disable — Redis speeds reads, but it needs invalidation when the change must take effect immediately. On the frontend, listing via `GET /links` (instead of a client-only inventory) keeps the backend as the authority.

The decisions in this document and in `docs/` are the ones I chose to follow after that analysis; I need to be able to justify each trade-off.

### Compound Engineering

To avoid rebuilding the same context on every prompt, relevant decisions and lessons stay in architecture docs, ADRs, project rules, and specialized agents. The goal is to reuse context across units of work, not to accumulate files for their own sake.

#### Sources of truth

| Layer | Role |
|--------|------|
| `README.MD` | requirements, how to run, project view |
| `docs/architecture/` | implemented architecture ([system-design.md](docs/architecture/system-design.md)) |
| `docs/adr/` | architectural decisions and trade-offs |
| `docs/design/ui.md` | UI design system (colors, typography, components) |
| `.cursor/rules/` | implementation guardrails |
| `.cursor/agents/` | analysis specialists |

Do not duplicate decisions across those layers: rules and agents point at the documentation; they do not rewrite it.

#### Structure

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

**Rules** — guardrails applied during development:

- `00-project` — scope, sources of truth, dependencies, documentation, and Git;
- `backend` — NestJS, TypeScript, API, Prisma/PostgreSQL, concurrency, and performance;
- `frontend` — React, TypeScript, API integration, UX, and accessibility.

**Agents** — specialists on demand:

- `architect` — alternatives and trade-offs before relevant architectural decisions;
- `database` — modeling, queries, indexes, migrations, integrity, and concurrency;
- `testing` — scenarios derived from requirements and gaps, independent of the implementation;
- `reviewer` — compares implementation, requirements, documentation, and tests before commit.

#### Flow

```text
Requirement
  → Context
  → Plan
  → Architecture / Data review (when needed)
  → Implementation
  → Testing
  → Technical review
  → Human review
  → Manual commit
```

Not every agent joins every change. Examples: a relevant architectural decision → `architect`; a sensitive persistence change → `database`; a new business rule → `testing`; a finished unit → `reviewer`. Specialize only when it adds value.

---

# Execution plan

Before implementation, I split the work into stages so I would not try to solve every problem at once.

The priority was to close the foundation and the backend critical path first. The frontend came after the main API contracts were working.

## Friday — 18/09 — Foundation and architecture

Goal: finish the day with the problem understood and the project base defined, without jumping into implementation.

- [x] full reading of the problem;
- [x] functional and non-functional requirements;
- [x] redirect identified as the critical path;
- [x] volume estimates and scale-point analysis;
- [x] initial architecture;
- [x] initial decision to use PostgreSQL, Redis, and asynchronous processing;
- [x] initial cache strategy;
- [x] analysis of `maxClicks` concurrency;
- [x] initial strategy for statistics at high access volume;
- [x] system design sketch;
- [x] repository created;
- [x] initial decisions documented.

By the end of this stage I wanted clarity on what would be built and, mainly, why each component exists.

---

## Saturday — 19/09 — Backend and critical path

Goal: finish the day with the functional core working.

### Foundation

- [x] create the monorepo structure;
- [x] set up NestJS;
- [x] set up PostgreSQL;
- [x] set up Prisma;
- [x] set up Redis;
- [x] create Docker Compose;
- [x] configure environment variables and `.env.example`;
- [x] create and validate the initial migrations.

### Links

- [x] implement `POST /links`;
- [x] validate the destination URL;
- [x] implement custom slugs;
- [x] define and implement automatic slug generation;
- [x] guarantee uniqueness in the database;
- [x] implement `expiresAt`;
- [x] implement `maxClicks`;
- [x] implement per-IP rate limiting.

### Redirect

- [x] implement `GET /:slug`;
- [x] return `404` for missing links;
- [x] return `410` for unavailable links;
- [x] implement `302` redirect;
- [x] implement Redis cache-aside;
- [x] handle cache hit and cache miss;
- [x] implement cache invalidation;
- [x] handle `maxClicks` concurrency.

### Analytics

- [x] define the queue mechanism;
- [x] publish access events without blocking the redirect;
- [x] create the worker;
- [x] persist individual accesses;
- [x] update the total counter;
- [x] update daily aggregates;
- [x] make sure analytics processing failures do not block the redirect.

The main Saturday goal was this flow:

    create link
        |
        v
    receive slug
        |
        v
    open slug
        |
        v
    resolve via cache/database
        |
        v
    validate rules
        |
        v
    publish event
        |
        +-------------> worker
        |
        v
    return 302

Once that path is solid, the rest of the application sits on a working base.

---

## Sunday — 20/09 — Statistics, frontend, and tests

Goal: turn the working backend into a complete delivery.

### Statistics

- [x] implement `GET /links/:slug/stats`;
- [x] return the access total;
- [x] return the daily series for the last seven days;
- [x] return the last 20 accesses;
- [x] validate the indexes used by the queries;
- [x] make sure the queries do not scan the full history.

### Link updates

- [x] implement `PATCH /links/:slug`;
- [x] allow disable;
- [x] invalidate the matching cache immediately;
- [x] validate redirect behavior after the change.

### Frontend

- [x] create the React app;
- [x] implement the create-link form;
- [x] list created links;
- [x] show the access total;
- [x] create the statistics view;
- [x] handle loading and error states;
- [x] keep the interface simple, functionality first.

### Tests

- [x] link creation;
- [x] invalid URL;
- [x] duplicate custom slug;
- [x] expiration;
- [x] disable;
- [x] `maxClicks`;
- [x] concurrency at the click limit;
- [x] `302` redirect;
- [x] cache hit;
- [x] cache miss;
- [x] cache invalidation;
- [x] access-event processing;
- [x] statistics;
- [x] at least one full redirect E2E flow.

### Documentation

- [x] review this README;
- [x] update decisions that changed during implementation;
- [x] document the final slug-generation strategy;
- [x] document the final `maxClicks` solution;
- [x] document the chosen asynchronous processing mechanism;
- [x] update the AI-use section;
- [x] add the final system design;
- [x] document how to run the application;
- [x] document how to run the tests.

---

## Monday — 21/09 — Validation and delivery

Monday was reserved for review and handoff, not for planned new features.

Final validation simulates the environment of someone receiving the project.

The idea is to start from a clean clone and check that the documented instructions alone are enough to run the application.

### Final checklist

- [x] clone the repository into a clean directory;
- [x] configure environment variables from `.env.example`;
- [x] run `docker compose up`;
- [x] confirm migrations apply correctly;
- [x] confirm frontend, API, PostgreSQL, Redis, and worker start;
- [x] create a link in the UI;
- [x] open the short link;
- [x] confirm the `302` redirect;
- [x] confirm the access was recorded;
- [x] query statistics;
- [x] disable the link;
- [x] confirm the next access returns `410`;
- [x] run the full test suite;
- [x] check that no secret was committed;
- [x] review the commit history;
- [x] review the README;
- [x] review the system design;
- [x] check that I can justify the implemented decisions.

Only after that validation is the repository shared for review.

---

## Scope-cut order

If the schedule gets tight, I prioritize in this order:

1. the application starting correctly with Docker Compose;
2. backend business rules;
3. redirect and its error cases;
4. automated tests;
5. asynchronous access recording;
6. statistics endpoint;
7. a working frontend;
8. visual polish and refinements.

I do not trade correctness or tests for infrastructure or finish work that is outside the main criteria.
