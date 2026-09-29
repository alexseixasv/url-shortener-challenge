# Architecture Decision Records (ADRs)

Record decisions with trade-offs that another engineer needs in order to understand the project.

## When to write an ADR

Write an ADR when the decision:

- involves alternatives with lasting consequences;
- affects latency, concurrency, persistence, cache, or contracts;
- would probably need to be explained outside the code.

Do not write an ADR for trivial implementation details.

## Format

```text
# ADR-NNN: Title

## Context

## Alternatives considered

## Decision

## Consequences

## Status
```

## Evolution

Decisions can be replaced by later ADRs. Prefer recording the change (status `superseded` / new ADR) instead of deleting the previous reasoning.
