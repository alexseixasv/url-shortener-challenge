# Architecture Decision Records (ADRs)

Registre aqui decisões com trade-offs relevantes para outro engenheiro entender o projeto.

## Quando criar um ADR

Crie um ADR quando a decisão:

- envolve alternativas com consequências duradouras;
- afeta latência, concorrência, persistência, cache ou contratos;
- provavelmente precisaria ser explicada fora do código.

Não crie ADR para detalhes triviais de implementação.

## Formato

```text
# ADR-NNN: Título

## Contexto

## Alternativas consideradas

## Decisão

## Consequências

## Status
```

## Evolução

Decisões podem ser substituídas por ADRs posteriores. Prefira registrar a mudança (status `superseded` / novo ADR) em vez de apagar o raciocínio anterior.
