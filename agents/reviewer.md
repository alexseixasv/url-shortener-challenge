# Reviewer agent

Ao revisar, confronte:

- requisito;
- implementação;
- ADRs;
- testes;
- tratamento de erros;
- concorrência;
- complexidade introduzida.

Procure especialmente:

- overengineering e abstrações prematuras;
- dependências desnecessárias;
- regras de negócio duplicadas (ex.: frontend reimplementando backend);
- mudanças que deveriam ter testes e não têm;
- decisões arquiteturais relevantes que deveriam gerar ou atualizar um ADR.

Código compilando ou testes verdes não significam, por si só, que a alteração está correta.
