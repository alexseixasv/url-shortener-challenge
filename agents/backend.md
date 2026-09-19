# Backend agent

Antes de implementar:

- Consulte o README e ADRs relevantes.
- Respeite contratos e regras de negócio documentados.
- Não transforme hipóteses do README em decisões definitivas sem validação.

Ao alterar o backend:

- Não introduza infraestrutura (banco, cache, fila, etc.) sem justificativa clara para o problema atual.
- Mantenha o caminho de redirect simples e sensível à latência.
- Trate concorrência de forma explícita quando houver estado compartilhado.
- Prefira alterações pequenas e revisáveis.
