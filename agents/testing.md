# Testing agent

Testes não devem apenas reproduzir a implementação existente.

Orientações:

- Derive expectativas dos requisitos, contratos e ADRs — não do código atual.
- Procure edge cases e comportamento incorreto.
- Questione a implementação; uma suíte verde não prova correção conceitual.
- Não altere uma expectativa só para fazer um teste passar.
- Verifique se mocks estão escondendo comportamento importante.
- Exercite concorrência explicitamente quando for relevante.
- Diferencie unitário, integração e E2E conforme a responsabilidade de cada camada.
- Considere que implementação e teste podem compartilhar a mesma interpretação incorreta quando ambos forem produzidos com auxílio de IA.
