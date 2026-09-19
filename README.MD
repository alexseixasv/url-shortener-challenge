# Encurtador de URLs

Implementação de um desafio técnico para construção de um encurtador de URLs com estatísticas de acesso.

Antes de começar a implementação, preferi registrar minha leitura do problema, os pontos que considero mais críticos e as decisões iniciais de arquitetura.

Algumas dessas decisões ainda podem mudar durante o desenvolvimento caso a implementação revele algum trade-off que não esteja evidente neste momento.

> **Status atual:** planejamento e arquitetura concluídos. Implementação ainda não iniciada.

---

## Ambiente local

Com Docker instalado:

```bash
cp .env.example .env
docker compose up
```

Serviços no host (portas padrão do `.env.example`):

| Serviço | URL / endereço |
|---------|----------------|
| API | http://localhost:3000 |
| Web | http://localhost:5173 |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

Dentro da rede do Compose, os hostnames dos serviços são `api`, `web`, `postgres` e `redis`.

A API ainda não conecta ao PostgreSQL nem ao Redis nesta etapa.

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
- **Redis** para cache, rate limiting e operações que precisam de atomicidade;
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

Ainda vou definir durante a implementação qual mecanismo vou utilizar para essa fila. Quero manter essa escolha proporcional ao problema e ao ambiente executado via Docker Compose.

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

---

## Cache e desativação

Adicionar cache cria outro problema que precisa ser tratado explicitamente.

Se um link estiver armazenado no Redis e for desativado no PostgreSQL, não posso esperar o TTL do cache expirar para que a alteração tenha efeito.

O requisito é que a desativação seja percebida imediatamente.

Portanto, ao alterar um link:

    PATCH /links/:slug
            |
            v
       PostgreSQL
       active = false
            |
            v
         Redis
       DEL link:{slug}

A alteração persistente deve ser acompanhada da invalidação da entrada correspondente no cache.

Assim, a próxima tentativa de acesso não continuará utilizando uma versão antiga do link.

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

Minha intenção inicial é utilizar uma operação atômica no Redis para controlar esse contador no caminho do redirect, mantendo posteriormente o estado persistido no PostgreSQL.

Antes de fechar essa implementação, quero validar principalmente:

- inicialização do contador;
- cache miss;
- expiração;
- concorrência;
- comportamento em caso de indisponibilidade do Redis;
- sincronização com o estado persistido.

A solução final será documentada depois dessa validação.

---

## Slugs

Slugs personalizados são mais simples.

O banco terá uma restrição `UNIQUE` em `slug`, e uma tentativa de reutilizar um valor existente deve falhar sem sobrescrever o link anterior.

Para os slugs automáticos, pretendo utilizar caracteres compatíveis com Base62:

    0-9
    a-z
    A-Z

Isso oferece um espaço grande de combinações mantendo URLs curtas e compatíveis com o formato necessário.

Ainda não considero a estratégia de geração fechada.

Existem algumas opções possíveis, como:

- gerar valores aleatórios e tratar colisões;
- derivar o slug de um identificador único;
- utilizar outra estratégia que garanta distribuição e simplicidade operacional.

Quero tomar essa decisão durante a implementação considerando principalmente:

- tamanho do slug;
- possibilidade de colisão;
- concorrência;
- previsibilidade;
- necessidade de consultas adicionais;
- complexidade introduzida.

Independentemente da estratégia escolhida, a unicidade continuará sendo garantida pelo PostgreSQL.

---

## Rate limiting

A criação de links terá rate limiting por IP.

Como o Redis já faz parte da arquitetura, pretendo utilizá-lo também para manter os contadores dessa limitação, evitando adicionar outro componente apenas para isso.

O redirecionamento não terá o mesmo limite, já que é justamente o endpoint projetado para receber o maior volume de tráfego.

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

Estou utilizando IA como ferramenta de apoio durante o desafio.

Nesta etapa inicial, usei principalmente para confrontar as decisões que estava tomando: levantar casos de concorrência, questionar pontos frágeis da arquitetura e discutir alternativas antes de começar a escrever código.

Um exemplo foi a discussão sobre `maxClicks`: uma implementação simples baseada em leitura e incremento poderia funcionar em testes básicos, mas teria comportamento incorreto com requisições concorrentes.

Outro ponto discutido foi a relação entre cache e desativação imediata dos links. Adicionar Redis melhora o caminho de leitura, mas também cria a responsabilidade de invalidar esse estado quando uma alteração precisa ter efeito imediato.

Também utilizei IA para revisar o desenho inicial da arquitetura e procurar componentes que estivessem sendo adicionados sem necessidade real.

As decisões descritas neste documento são as que escolhi seguir depois dessa análise e preciso conseguir justificar os trade-offs de cada uma delas.

Se eu utilizar IA em outras partes relevantes da implementação, vou atualizar esta seção indicando onde e com qual finalidade ela foi utilizada.

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

- [ ] criar a estrutura do monorepo;
- [ ] configurar NestJS;
- [ ] configurar PostgreSQL;
- [ ] configurar Prisma;
- [ ] configurar Redis;
- [ ] criar o Docker Compose;
- [ ] configurar variáveis de ambiente e `.env.example`;
- [ ] criar e validar as migrations iniciais.

### Links

- [ ] implementar `POST /links`;
- [ ] validar URL de destino;
- [ ] implementar slug personalizado;
- [ ] definir e implementar a geração automática de slug;
- [ ] garantir unicidade no banco;
- [ ] implementar `expiresAt`;
- [ ] implementar `maxClicks`;
- [ ] implementar rate limiting por IP.

### Redirect

- [ ] implementar `GET /:slug`;
- [ ] retornar `404` para links inexistentes;
- [ ] retornar `410` para links indisponíveis;
- [ ] implementar redirect `302`;
- [ ] implementar cache-aside com Redis;
- [ ] tratar cache hit e cache miss;
- [ ] implementar invalidação de cache;
- [ ] tratar concorrência relacionada a `maxClicks`.

### Analytics

- [ ] definir o mecanismo da fila;
- [ ] publicar eventos de acesso sem bloquear o redirect;
- [ ] criar o worker;
- [ ] persistir os acessos individuais;
- [ ] atualizar o contador total;
- [ ] atualizar as agregações diárias;
- [ ] garantir que falhas no processamento de analytics não impeçam o redirect.

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

- [ ] implementar `GET /links/:slug/stats`;
- [ ] retornar total de acessos;
- [ ] retornar série diária dos últimos sete dias;
- [ ] retornar os últimos 20 acessos;
- [ ] validar os índices utilizados pelas consultas;
- [ ] garantir que as consultas não dependam de percorrer todo o histórico.

### Alteração de links

- [ ] implementar `PATCH /links/:slug`;
- [ ] permitir desativação;
- [ ] invalidar imediatamente o cache correspondente;
- [ ] validar o comportamento do redirect após a alteração.

### Frontend

- [ ] criar a aplicação React;
- [ ] implementar formulário de criação de links;
- [ ] listar links criados;
- [ ] exibir total de acessos;
- [ ] criar visualização das estatísticas;
- [ ] tratar estados de loading e erro;
- [ ] manter a interface simples, priorizando funcionalidade.

### Testes

- [ ] criação de link;
- [ ] URL inválida;
- [ ] slug personalizado duplicado;
- [ ] expiração;
- [ ] desativação;
- [ ] `maxClicks`;
- [ ] concorrência no limite de acessos;
- [ ] redirect `302`;
- [ ] cache hit;
- [ ] cache miss;
- [ ] invalidação de cache;
- [ ] processamento dos eventos de acesso;
- [ ] estatísticas;
- [ ] pelo menos um fluxo E2E completo de redirecionamento.

### Documentação

- [ ] revisar este README;
- [ ] atualizar decisões que tenham mudado durante a implementação;
- [ ] documentar a estratégia final de geração de slugs;
- [ ] documentar a solução final para `maxClicks`;
- [ ] documentar o mecanismo escolhido para processamento assíncrono;
- [ ] atualizar a seção de uso de IA;
- [ ] adicionar o System Design final;
- [ ] documentar como executar a aplicação;
- [ ] documentar como executar os testes.

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