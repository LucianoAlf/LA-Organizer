# Memória de grupo do TOM — design

**Data:** 2026-09-02
**Autor:** brainstorm com o Alf (4 decisões fechadas + 3 seções aprovadas)
**Status:** aprovado para virar plano de implementação

---

## 1. Problema

O TOM entrou no grupo do administrativo do Recreio em 02/09. Na primeira hora o time já pediu
duas coisas que dependem de memória: acompanhar pendências de cadastro por aluno, e lembrar de
combinados ("o contrato do Kaique não sai porque o aluno está em aviso prévio").

O Alf quer que o TOM **fique em silêncio, ouça tudo e guarde** — como a Maria faz hoje — e que,
quando a equipe o corrigir, ele **aprenda e não repita o erro**.

### O que já existe (levantado em 02/09, não é suposição)

- **`collaborator_memory`** — memória semântica viva para PESSOAS: `memory_type`
  (`fact` 400 · `context` 42 · `lesson` 24 · `preference` 22 · `decision` 16),
  `importance` (critical/high/normal/low), `decay_at` (o eixo curto/médio/longo prazo),
  `is_active`, e **`embedding` pgvector preenchido em 100% das linhas**.
- **O Dream (`DAILY_DREAM_TIME = '03:00'`)** roda todo dia: consolida memória de cada
  colaborador (`consolidateMemoryFor`, engine ~14495, janela de 7 dias) e audita a conversa.
  **Ele JÁ percorre os grupos no mesmo laço** — mas só chama `auditGroupConversation`.
  **Julga o grupo e não guarda nada dele.**
- **`work_groups.tom_chat_memory`** — resumo rolante em HTML gravado por
  `group-chat-closing.js` quando a sessão fica idle ≥ 8 min, injetado no prompt como
  `longTermMemory`.

### Onde trava hoje

1. **Teto de ~3000 chars cortado pelo início.** O grupo Financeiro está em **2995/3000**: já
   descarta o começo a cada sessão. É perda de dado silenciosa, não decisão de design.
2. **É resumo, não estrutura.** Não separa decisão de regra de aprendizado — não dá pra
   consultar nem pra a sonda checar aderência.
3. **Só captura sessão em que falaram COM ele** (gatilho `tom_chat_engaged_at`). Conversa da
   equipe entre si não vira memória — justamente o "ouvir em silêncio".

**A capacidade não é nova. É a metade que falta: o sujeito GRUPO.**

---

## 2. Decisões fechadas

| # | Decisão | Escolha |
|---|---|---|
| 1 | Escopo da memória | **Por grupo, isolada.** O Recreio nunca vê o Financeiro. O campo nasce pronto pra virar compartilhado se um dia fizer falta. |
| 2 | Como o TOM lê de volta | **Híbrido:** bloco fixo curto sempre no prompt + busca semântica só sob gatilho explícito. |
| 3 | Lições (regra de comportamento) | **Passam pelo Alf.** `fact`/`decision`/`context` entram sozinhas; `lesson` nasce inativa e só entra no prompt com aprovação. |
| 4 | Rollout | **Todo grupo que teve conversa no dia.** Grupo parado não consolida. |

**Abordagem escolhida (A):** tabela `group_memory` gêmea da `collaborator_memory`, com o
*código* de acesso compartilhado num módulo único. Tabela separada, código único.

Descartadas: **(B)** sujeito polimórfico na `collaborator_memory` — migration em tabela viva com
embeddings, mexendo no caminho 1:1 que está saudável; risco no que não está quebrado.
**(C)** `tom_chat_memory` como JSONB — sem embedding não há busca semântica, e campo único
volta a ser teto em dois meses.

**Fora de escopo (YAGNI):** supersede e versionamento de memória. `is_active` + a comparação
com o que já existe cobrem a fatia 1. Se aparecer contradição real de combinado, resolve depois
com dado na mão.

---

## 3. Modelo de dado

### Tabela `group_memory`

Espelha `collaborator_memory` e acrescenta quatro campos que se pagam:

| campo | tipo | papel |
|---|---|---|
| `id` | uuid PK | |
| `group_id` | uuid NOT NULL → `work_groups(id)` ON DELETE CASCADE | o sujeito |
| `memory_type` | text | mesmo vocabulário do 1:1: `fact`, `context`, `lesson`, `preference`, `decision` |
| `content` | text | a memória em si |
| `importance` | text | `critical` / `high` / `normal` / `low` |
| `decay_at` | timestamptz NULL | eixo curto/médio/longo prazo (NULL = não expira) |
| `is_active` | boolean DEFAULT true | entra no prompt? |
| `embedding` | vector | busca semântica |
| `source` | text | origem (`dream:2026-09-03`) |
| **`occurred_on`** | date NOT NULL | **o dia da conversa que gerou.** Sem isso ele lembra do combinado e não sabe quando — foi pedido explícito do Alf |
| **`evidence`** | text | **o trecho literal** que originou a memória. É o que separa memória de invenção |
| **`approved_at`** | timestamptz NULL | o gate das lições |
| `created_at` / `updated_at` | timestamptz | |

**Índices:** `(group_id, is_active)` para o bloco de leitura; índice vetorial em `embedding`
espelhando o que a `collaborator_memory` já usa.

### O gate das lições, sem coluna extra

`lesson` nasce `is_active = false`, `approved_at = null`. Existe no banco, **não entra no
prompt**. Aprovar é ligar `is_active = true` e carimbar `approved_at` — literalmente o freio que
o Alf escreveu para o loop da Maria ("regra soft só entra no runtime com `ativo=true`").

Três estados distinguíveis sem coluna nova:

| estado | `is_active` | `approved_at` |
|---|---|---|
| candidata | false | null |
| ativa | true | preenchido |
| aposentada | false | preenchido |

`fact`, `decision`, `context` e `preference` nascem `is_active = true`, `approved_at = null`.

### O módulo único — `src/services/agent-memory.js`

Dono da lógica que **não depende de tabela**: comparar candidata com o que já existe
(anti-duplicata), normalizar importância, calcular `decay_at`, gerar embedding. Recebe o sujeito
(`{ kind: 'group' | 'collaborator', id }`) e delega a query.

**Limite explícito e assumido:** o caminho 1:1 **não é reescrito nesta fatia**. Ele está saudável
e é o mais crítico do TOM — reescrevê-lo agora é exatamente o risco recusado na abordagem B. O
módulo nasce **extraído** da lógica do 1:1 (não reimplementado), com **teste de paridade**
provando que os dois produzem a mesma saída para a mesma entrada. O 1:1 migra numa fatia
posterior, depois de o módulo ter rodado semanas em grupo. O drift fica **adiado e visível**,
com teste que falha se divergir — não escondido.

---

## 4. Escrita — o Dream das 3h

**Onde entra:** no laço de grupos que o Dream **já percorre** (dispatcher ~3944). Ele varre os
grupos ativos e chama `auditGroupConversation`; passa a chamar também `consolidateGroupMemoryFor`.
Uma volta a mais no mesmo laço, não um ritual novo.

**Piso:** só grupo com mensagem nas últimas 24h. Grupo parado não gera chamada de LLM.

**Janela: 24 horas** (o 1:1 usa 7 dias). Pessoa passa dias sem falar; grupo de trabalho conversa
todo dia. Com 24h o `occurred_on` sai exato e não se re-extrai a mesma coisa sete noites seguidas.

**Entrada do extrator:** o histórico do grupo do dia **inteiro — inclusive as mensagens que não
falam com o TOM**. É aqui que o "ouvir em silêncio" acontece. Cada linha traz quem falou.

**Saída:** candidatas tipadas, cada uma com `content`, `memory_type`, `importance` e `evidence`
(o trecho literal). **Teto de 8 por grupo por noite** — grupo movimentado não pode despejar 40
memórias e afogar o bloco de leitura.

### Quatro travas, cada uma com dono conhecido

- **Anti-vacuidade** — dia sem conteúdo real devolve zero candidatas. Não inventa regra pra
  justificar a rodada. Foi a primeira coisa que a Maria precisou.
- **Anti-duplicata** — compara com as memórias ativas do grupo antes de inserir (lógica do
  módulo, herdada do 1:1).
- **Sem segredo** — o chat de grupo carrega senha e credencial. Candidata que casa padrão de
  credencial **não é gravada**, e `evidence` vai truncado. Senha vira ficha com campo secreto,
  não memória que entra em prompt.
- **Sensor de falha** — se o extrator quebrar, grava zero. **Zero por falha é byte a byte igual
  a zero por dia tranquilo** — a doença que cegou a auditoria de 29/08 a 01/09. Cada rodada
  registra o que aconteceu, e o painel de grupos do laudo diário (commit `c566870c`) mostra
  quando um grupo parou de consolidar.

**Idempotência:** rodou hoje para esse grupo, não roda de novo — o Dream já faz isso por pessoa
(`alreadySent(c.id, 'daily_dream', ymd)`); o grupo ganha o equivalente.

---

## 5. Leitura

### Bloco fixo (sempre no prompt)

Substitui os 3000 chars de resumo. Montado das memórias **ativas** do grupo, ordenadas por
importância e recência, com teto de caracteres. **Cada linha carrega a data**:

```
12/08 — ficou combinado que boleto de material vai no grupo e por e-mail
02/09 — contrato do Kaique Batista não sai: aluno em aviso prévio, mãe não assina
```

### Busca sob gatilho

**Chokepoint determinístico, não instrução de prompt** (mesma lição da Maria: a via de consulta
é código, não confiança no LLM). Quando a frase é de recuperação — "qual foi o combinado",
"a gente já decidiu isso", "me lembra o que ficou" — a pergunta vira embedding e traz as
memórias mais próximas **daquele grupo**.

**Honesto-vazio:** se a busca não achar nada, ele diz que não achou. Memória que inventa é pior
que memória que falta.

### Transição do buffer velho — por grupo, não por data

O card de fechamento de sessão **continua** (o time vê o resumo no chat), mas para de alimentar
`tom_chat_memory`. Enquanto o grupo tiver **menos de 3 memórias ativas**, o prompt segue usando
o buffer antigo; a partir daí, só o novo. Nenhum grupo passa um dia sem contexto, e não há dia
de virada global.

---

## 6. Ordem de entrega

1. **Escrever, sem ler.** Tabela + módulo + consolidação no Dream. **O prompt não muda.** Ele
   guarda por alguns dias e o Alf lê o que foi guardado.
2. **Leitura.** Bloco fixo e busca sob gatilho. Com dado real na mesa, o teto e o formato se
   decidem sozinhos.
3. **Aprovação de lições** no laudo diário.

A ordem protege do pior cenário: ligar a leitura em cima de um extrator que ainda tira bobagem.

---

## 7. Como se prova

**Antes de ligar:** rodar o consolidador em **dry-run contra o histórico real do Recreio de
02/09** — as 21 mensagens dos 5 contratos, do Kaique e do pedido do Clayton — e mostrar ao Alf o
que sairia, **sem gravar nada**. Se sair bom, liga; se sair bobagem, ajusta com custo zero.

**Testes puros:** composição do bloco (ordem, teto, data em cada linha); o gatilho da busca
(dispara nas frases de recuperação, não dispara em conversa comum); anti-duplicata;
anti-vacuidade; filtro de credencial; a transição buffer→tabela nos dois lados do limiar de 3;
paridade entre o módulo e a lógica 1:1 de origem.

**Baseline:** suíte inteira verde (`node --env-file=.env --test src/`), com as 3 falhas
pré-existentes de `system-loadout`.

---

## 8. Custo

- **Escrita:** 1 chamada de LLM por grupo com conversa por noite (hoje: 2 a 4) + 1 embedding por
  memória gravada (teto de 8 por grupo).
- **Leitura:** bloco fixo custa **zero** LLM. A busca gasta 1 embedding da pergunta, e só quando
  o gatilho dispara.

---

## 9. Referências no código

| o quê | onde |
|---|---|
| Dream (laço que já percorre grupos) | `src/rituals/dispatcher.js` ~3888 e ~3944 |
| Consolidação 1:1 (origem do módulo) | `src/engine.js` ~14495 (`consolidateMemoryFor`, `_consolidateExtract`) |
| Buffer rolante atual | `src/services/group-chat-closing.js` ~168 |
| Injeção no prompt de grupo | `src/services/group-chat-engine.js` ~273 (`longTermMemory`) |
| Painel de grupos no laudo | `src/rituals/health-check.js` (`checkGruposAtivos`) |
