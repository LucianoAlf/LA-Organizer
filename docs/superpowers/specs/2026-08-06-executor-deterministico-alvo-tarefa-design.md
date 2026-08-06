# Executor determinístico do ALVO da tarefa — Fatia A

**Data:** 2026-08-06
**Trilha:** 1 (raiz), primeira fatia
**Status:** aprovado por Alf; a implementar
**Autores:** Catraca (spec) · Alfredo (revisão e teste) · Alf (decisão)

---

## 1. O problema, medido

A auditoria de 27/07 apontou `TASK_UPDATE` — a ação mais usada, 411 vezes/mês — falhando ~14%
por "não identificar de qual tarefa se fala", com a observação de que 60% das tarefas pendentes
têm título duplicado.

Medi no banco de produção em **06/08/2026** e o diagnóstico mudou de forma:

| | Tarefas | % das abertas |
|---|---|---|
| Abertas (com responsável) | 508 | — |
| Em grupo de título duplicado | 309 | 61% |
| — dessas, **mesma SÉRIE recorrente** | **273** | **54%** |
| — **ambiguidade REAL** (11 grupos, linhagens distintas) | **36** | **7%** |

Os 61% estavam inflados. A maior parte não é ambiguidade — é série recorrente materializada.
Perguntar "qual das 35?" seria burrice operacional.

### O defeito mecânico

Os três handlers de tarefa resolvem alvo por título assim (`src/engine.js`):

```js
.ilike('title', `%${a.title.slice(0, 60)}%`)
.order('created_at', { ascending: false })
.limit(1)
.maybeSingle()
```

O `.limit(1)` **esconde a pluralidade**: quando há N candidatos, o código escolhe um e segue
como se tivesse certeza. E o critério — mais recentemente criado — é justamente o pior para
uma série materializada, porque as instâncias futuras nascem depois.

Prova, série `Presença Emusys` (35 instâncias abertas, 1 pessoa):

| | due_date |
|---|---|
| O que o código escolhe hoje (`created_at desc`) | **2026-09-04** |
| Ocorrência corrente (`due_date asc`) | **2026-08-01** |

A pessoa diz *"passa a Presença Emusys pra amanhã"*. O TOM move uma ocorrência **de setembro**.
A de agosto, atrasada, continua parada. A pessoa olha a lista, nada mudou, e conclui que o TOM
ignorou o pedido — o padrão `dropped_request`, que é a dor nº 1 em produção (24 achados em 14
dias, 12 pessoas distintas, o último em 06/08).

No `complete` é pior: *"conclui a Presença Emusys"* marcaria a de setembro como feita e deixaria
a de agosto aberta. O TOM afirma "✅ concluí" e o trabalho continua lá — isso é `confabulation`,
não apenas pedido perdido.

### Os três lugares

O mesmo bloco existe em `src/engine.js`, comentado no próprio código como "mesmo padrão":

| Handler | Linha do `order('created_at'…)` |
|---|---|
| `complete` | 4413 |
| `cancel` | 4662 |
| `reschedule` | 4741 |

Corrigir só o reagendamento deixaria a mesma bomba armada nos outros dois. Esta é literalmente
a armadilha recorrente da casa — regra presente em N leitores e ausente no N+1 — que produziu
`GROUPPKG-CONTAINER-PHANTOM-FLATLIST` (20/06) e o caso Rose de 03/08.

---

## 2. Objetivo desta fatia

Tirar do LLM e do acaso a decisão de **qual tarefa** uma frase se refere, quando os candidatos
são a mesma série recorrente. Cobre 54% das tarefas abertas, sem tocar no fluxo de confirmação,
sem mudar o jeito do TOM falar e sem migration.

**Não-objetivos, declarados:**

- Ambiguidade real (linhagens distintas, 7%) — é a **Fatia B**, especificada na seção 8.
- Fluxo de confirmação/prévia estilo financeiro — decisão adiada até a Fatia A ser medida.
- Voz, tom ou tamanho da resposta do TOM (`soul/`, `skills/`) — intocados.
- Handlers de evento, hábito, grupo — fora.

---

## 3. Arquitetura

Um módulo **puro** novo — sem banco, sem LLM, sem `engine` — consumido pelos três handlers.

```
engine (busca candidatos)  →  resolveTaskTarget({ candidatos, hoje })
                                        ↓
                        { modo: 'exato',   tarefa }        → executa
                        { modo: 'ambiguo', candidatos[] }  → comportamento atual + log (Fatia A)
                        { modo: 'nenhum' }                 → prosa honesta de "não achei"
```

**Arquivo:** `src/lib/task-target.js` (+ `.test.js`)

**Por que módulo puro e não inline:** `engine.js` tem 14.671 linhas e é o alvo declarado da
refatoração. Decisão dentro dele não é testável isoladamente nem provável por mutação. Puro,
a escada roda em milissegundos com 20 casos e a mutação prova que a regra existe.

**Por que arquivo novo e não estender `reply-ref.js`:** `reply-ref` tem contrato próprio
(citação → alvo exato por id) e é consumido em outro ponto. O `task-target` **compõe** com ele
— consome seu resultado como sinal — em vez de engoli-lo. Duas responsabilidades, dois módulos.

---

## 4. A regra

### Assinatura

```js
resolveTaskTarget({ candidatos, hoje })
// candidatos: Array<{ id, title, due_date, recurrence_rule, recurrence_parent_id, created_at }>
// hoje: 'YYYY-MM-DD' em BRT
// → { modo: 'exato'|'ambiguo'|'nenhum', tarefa?, candidatos?, motivo }
```

### Decisão, em ordem

1. **0 candidatos** → `{ modo: 'nenhum', motivo: 'sem_candidato' }`.
2. **1 candidato** → `{ modo: 'exato', tarefa, motivo: 'unico' }`.
3. **N candidatos, TODOS da mesma linhagem, com pelo menos um `due_date` não-nulo**
   → `{ modo: 'exato', tarefa: <ciclo corrente>, motivo: 'serie' }`.
4. **N candidatos, TODOS da mesma linhagem, TODOS com `due_date` nulo**
   → `{ modo: 'ambiguo', candidatos, motivo: 'serie_sem_data' }` — sem data não há como
   ordenar sem chutar.
5. **N candidatos, linhagens distintas** → `{ modo: 'ambiguo', candidatos, motivo: 'linhagens_distintas' }`.

### Mesma linhagem

Dois candidatos são da mesma série quando compartilham a chave:

```
serie(t) = t.recurrence_parent_id ?? (t.recurrence_rule != null ? t.id : null)
```

Todos da mesma linhagem ⟺ o conjunto de `serie(t)` não-nulo tem exatamente 1 elemento **e**
nenhum candidato tem `serie(t) === null`. Um avulso no meio da lista torna o conjunto ambíguo —
de propósito: avulso com nome igual ao da série não é "a série".

### Ciclo corrente

**A ocorrência de menor `due_date` entre as candidatas abertas.** Uma regra só:

- se há atrasada, é ela (menor `due_date` é a mais antiga);
- se todas são futuras, é a mais próxima.

Empate de `due_date` desempata por `created_at` ascendente (a mais antiga), determinístico.
Candidato com `due_date` nulo nunca é o ciclo corrente; se **todos** forem nulos, devolve
`{ modo: 'ambiguo', motivo: 'serie_sem_data' }` — não há como ordenar sem chutar.

Esta é a mesma regra já em produção em `resolveVisibleInstance`
(`src/services/group-chat-tasks.js`, testada): *"molde OU instância qualquer → SEMPRE o ciclo
corrente (menor due_date)"*. Não estamos inventando comportamento novo; estamos aplicando ao
chat 1:1 uma regra que o chat de grupo já usa.

---

## 5. Mudança nos três handlers

Em `src/engine.js`, nos ramos `complete` (~4405), `cancel` (~4654) e `reschedule` (~4735), o
bloco de `title-lookup` passa de "pega um" para "pega todos e decide":

**Antes**
```js
.ilike('title', `%${…}%`).order('created_at', { ascending: false }).limit(1).maybeSingle()
```

**Depois**
```js
.ilike('title', `%${…}%`).order('due_date', { ascending: true, nullsFirst: false }).limit(100)
// → resolveTaskTarget({ candidatos, hoje: todayYmdSP() })
```

O `limit(100)` é folga sobre o maior grupo real (42). **Quando o resultado atinge o teto, loga
`[TaskTarget] cap atingido`** — teto silencioso é como um filtro vira falso-verde.

**O que o handler faz com cada modo, na Fatia A** (explícito para não sobrar interpretação):

| Modo | Ação do handler |
|---|---|
| `exato` | Executa na tarefa devolvida. |
| `nenhum` | Caminho de "não achei" que já existe hoje, incluindo a mensagem de "é de outra pessoa". |
| `ambiguo` | **Mantém o comportamento de hoje** — escolhe por `created_at desc` entre os candidatos — e loga. Não pergunta, não recusa, não muda prosa. Perguntar é Fatia B. |

A linha do `ambiguo` é deliberada: a Fatia A não pode piorar nem melhorar os 7%, só medi-los.
Assim a diferença observada no cenário B é atribuível à regra de série, e não a uma segunda
mudança acontecendo junto.

O ramo de "a tarefa é de outra pessoa" (mensagem honesta quando existe para terceiro) fica como
está. O escopo de candidatos continua `assigned_to = eu OR created_by = eu`, sem alteração.

---

## 6. Flag e reversibilidade

`TOM_TASK_TARGET_SERIES` — **desligada por padrão**.

Desligada, cada handler executa o caminho de hoje, byte a byte. Ligada, consulta o resolvedor.
O gate fica em **um** ponto por handler, nunca espalhado.

---

## 7. Critérios de aceite

Nenhum destes é opcional. Verde sem eles não conta.

### 7.1 Unitário — `src/lib/task-target.test.js`

| Caso | Esperado |
|---|---|
| 0 candidatos | `nenhum` |
| 1 candidato | `exato`, motivo `unico` |
| 35 da mesma série, uma atrasada | `exato` na **atrasada** (menor due) |
| 35 da mesma série, todas futuras | `exato` na **mais próxima** |
| 2 linhagens distintas | `ambiguo` |
| série + 1 avulsa de mesmo nome | `ambiguo` |
| série com todos `due_date` nulos | `ambiguo`, motivo `serie_sem_data` |
| empate de `due_date` | `exato` na de `created_at` mais antigo, estável |

### 7.2 Mutação (a prova de que o teste mede)

Cada uma destas sabotagens tem de derrubar teste, com o alvo verificado antes (o arquivo mudou
mesmo) e restaurado depois (md5 conferido):

- trocar ciclo corrente por `created_at desc` → o bug original volta e cai;
- aceitar linhagens distintas como série → cai;
- devolver `exato` quando há 0 candidatos → cai.

### 7.3 Zero-regressão

Golden: para título **sem** duplicata, o alvo resolvido com a flag ligada é idêntico ao da flag
desligada, nos três handlers. Suíte cheia no baseline (hoje: `pass 2262 / fail 3` — os 3 são por
`SUPABASE_URL` ausente, não são regressão).

### 7.4 Replay Lab — cenário B

Conversa real contra o banco, no modelo do cenário A já em produção (8 verificações, N=20).

Fixtures: as três séries reais medidas hoje — `Presença Emusys` (35 instâncias, corrente
01/08), `marcar endócrino` (42), `fechamento da escola` (29) — recriadas em perfil de QA na
faixa reservada `5500…`, nunca as linhas de gente real.

Verificações **absolutas**:

- a instância tocada é a de **menor `due_date`** da série;
- nenhuma outra instância da série é alterada;
- o TOM **falou** (fala capturada no ponto único de saída) e o dia que ele nomeia bate com o
  que foi gravado;
- zero outbound real, zero resíduo no banco.

**Prova de reversão, obrigatória:** com `TOM_TASK_TARGET_SERIES` desligada, o cenário B tem de
ficar **vermelho**. Verde nos dois estados significa que o cenário não mede nada — foi
exatamente assim que o cenário A passou por vacuidade na primeira versão (dirigia
`remindOperationalTasks`, que nem lê `remind_at`).

### 7.5 Instrumentação que dimensiona a Fatia B

Todo retorno `ambiguo` loga `[TaskTarget] ambiguo motivo=<…> n=<…>` e registra marker
`TASK_TARGET_AMBIGUOUS`. Depois de uma semana em produção, a frequência real substitui a
estimativa de 7% deste retrato — a Fatia B nasce dimensionada por tráfego, não por snapshot.

---

## 8. Fatia B — declarada, não implementada

Escopo, para quando a Fatia A estiver medida:

- `task-target.js` ganha os sinais **exatos** de desempate, nesta ordem: `id` do marker
  (validado: dono + viva) → `reply-ref` (citação → id exato) → âncora do turno **quando o
  outbound que abriu o turno referenciou exatamente UMA tarefa**.
- Sobrando ambiguidade, o TOM **pergunta** "qual delas?" e abre intent
  `task_disambiguation` — **duas portas**: `VALID_KINDS` em `src/services/pending-intents.js`
  **e** o `CHECK` de `pending_intents.kind` no banco. Hoje as duas estão em sincronia com 9
  kinds; alterar uma só reproduz `TRAP-A`.
- A resposta ("1", "a segunda", "a do Recreio") é casada por **executor determinístico**, não
  pelo LLM — senão o cara-ou-coroa apenas anda um turno para frente.
- Guard anti-clobber: `supersede` é por `kind`, então um kind próprio escapa do registrador
  genérico de fim de turno (`COORD-CONFIRM-INTENT-CLOBBER`, 11/07).

Nada disso entra na Fatia A.

---

## 9. Armadilhas conhecidas, para quem implementar

1. **`.limit(1)` é o pecado, não o `ilike`.** O `LIKE` dá recall e é bom; o que mente é reduzir
   N a 1 sem contar. Não troque `ilike` por igualdade exata — isso explode a taxa de "não
   achei", porque ninguém fala o título completo.
2. **Teto silencioso.** `limit(100)` sem log de teto vira truncamento invisível.
3. **Data local nunca por `toISOString().slice(0,10)`.** Depois das 21h BRT o UTC já virou o
   dia. Use o `todayYmdSP()`/`Intl` que o projeto já tem.
4. **Timestamp do Postgres não compara como string.** `+00:00` ≠ `.000Z` para o mesmo instante;
   compare por `Date.parse`. Isso reprovou um fix correto em 05/08.
5. **Verificar o handler pelo CAMPO, não pelo nome.** Três funções com "task" no nome fazem
   coisas diferentes; a que importa é a que lê o campo em questão.
6. **`.deploy-hold` na raiz antes de editar `src/`** — há outros chats na mesma árvore, e o
   hook faz `git add -A`.
7. **Commitar.** Patch que vive só em `/opt/LA-Organizer` é apagado pelo próximo
   `git reset --hard origin/main`, em silêncio. Aconteceu em 06/08.

---

## 10. Resumo da decisão

| Ponto | Decisão |
|---|---|
| Escopo | Só identificação do alvo; confirmação/execução intocadas |
| Handlers | `complete`, `cancel`, `reschedule` — os três |
| Regra | Mesma série → ciclo corrente (menor `due_date`) |
| Ambiguidade real | Fatia A não resolve: mantém hoje + loga; Fatia B depois |
| Desempate | Só sinais exatos (Fatia B); nada de heurística |
| Módulo | `src/lib/task-target.js`, puro, compõe `reply-ref` |
| Flag | `TOM_TASK_TARGET_SERIES`, desligada por padrão |
| Prova | Unitário + mutação + zero-regressão + cenário B + reversão |
