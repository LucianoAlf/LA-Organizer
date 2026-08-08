# CHECKPOINT — 08/08/2026 · refatoração do TOM (chat Revisor/Catraca)

Ponto de retomada. Escrito para quem voltar sem contexto nenhum.

---

## 1. Fatia A — executor determinístico do ALVO da tarefa

**Problema:** quando o título casa com várias instâncias vivas da mesma série recorrente, o
lookup escolhia por `created_at desc` + `.limit(1)` — na prática a última materializada, lá na
frente. Trocado por **ciclo corrente (menor `due_date`)**, atrás da flag `TOM_TASK_TARGET_SERIES`.

**Spec:** `docs/superpowers/specs/2026-08-06-executor-deterministico-alvo-tarefa-design.md`
**Plano:** `docs/superpowers/plans/2026-08-06-executor-deterministico-alvo-tarefa-fatia-a.md`

| Task | O que é | Estado |
|---|---|---|
| 1 | `src/lib/task-target.js` (módulo puro, 8 testes) | ✅ |
| 2 | `logMarker` com `rawLimit` + `_logAlvoAmbiguo` | ✅ |
| 3 | handler `reschedule` | ✅ `dd5c9729` |
| 4 | handler `complete` | ✅ `10277e17` |
| 5 | handler `cancel` | ✅ `b30801c1` |
| 6 | cenário B do Replay Lab | ⚠️ **não entrega a prova** — ver abaixo |
| 6b | prova determinística (substituta) | ✅ `a3eaf172` — **6/6** |
| 7 | deploy gated + medição | 🟡 **flag LIGADA em 08/08 15:25 UTC — falta a MEDIÇÃO** |

### Por que a Task 6 não fechou
O cenário via Replay Lab conversa com o LLM. Fora da janela do prompt (que injeta só prazos dos
próximos 7 dias, `slice(0,8)`), o TOM quase sempre responde *"tem 3 com esse nome, qual delas?"* —
resposta correta, mas que impede o executor de rodar. Taxa de ação: 0–33%. **Não se prova peça
determinística através de componente não-determinístico.**

Substituída por `scripts/prova-executor-alvo-serie.js`, que chama `applyTaskActions` direto com o
marker **sem `id`**, nos dois modos, mesma fixture, mesmo processo:

```
complete    OFF → não mexe   |  ON → CORRENTE
cancel      OFF → LEGADO     |  ON → CORRENTE
reschedule  OFF → LEGADO     |  ON → CORRENTE      6/6 · resíduo 0
```

O cenário B **continua útil** (tem check anti-vacuidade `executor_rodou`), mas **não é gate de deploy**.

### Ligada — falta medir
`TOM_TASK_TARGET_SERIES=1` no `.env` da VPS desde **08/08 15:25 UTC** (backup do `.env` feito).
Reverter: tirar a linha e `pm2 restart tom` (10s).

**A Task 7 só fecha com a medição**, não com o deploy. O que olhar, daqui a alguns dias:
- `grep '\[TaskTarget\] serie' logs/` → quantas vezes o alvo mudou, e para qual `due`
- `marker_logs` com `marker_type='TASK_TARGET_AMBIGUOUS'` → os casos de linhagem distinta,
  que são o insumo da Fatia B (hoje ~10 grupos medidos, mantêm o legado)
- `grep 'cap atingido'` → se alguma série passou de 100 candidatos

### Dimensão real (medida em produção, não estimada)
- `919` ações de tarefa por **id** — não passam pelo lookup
- `40` title-lookup com sucesso · `27` "not found" (**40% do que entra já falha em achar**)
- → a fatia cobre **~7% do tráfego**, não a maioria
- Entre grupos com >1 candidato: 14 resolvem como série, **13 mudam de alvo**, e **12 desses** o
  legado pegava uma instância futura tendo uma atrasada

### Correção de relato (não repetir o erro)
Eu havia descrito o dano do `complete` como *"marcava a de setembro como feita e deixava a
atrasada aberta"*. **Errado.** O legado escolhe a mais distante, que é futura, e o guard
`isFutureCompletion` a barra: o TOM **não conclui nada** e devolve recusa confusa. Em `cancel` e
`reschedule` não há guard de data — ali o legado realmente age na instância errada.

---

## 2. Infra de deploy — CORRIGIDO e SINCRONIZADO

`auto-deploy.ps1` saía em `exit 0` quando não tinha o que commitar. Como os dois chats commitam à
mão durante o turno, a árvore chegava limpa e **a etapa que atualiza a VPS nunca rodava**.

Prova: último commit `Auto-deploy` = 03/08 09:15; 66 commits desde então, **zero do hook**; HEAD da
VPS era exatamente esse commit. **A produção ficou 5 dias sem receber git.**

Corrigido em `860295aa`: a sincronização passou a depender do **estado da VPS**
(`git rev-list --count HEAD..origin/main`), não do que o turno commitou.

**Estado (08/08 15:24):** Hugo liberou, hold removido, VPS sincronizada — `0` commits atrás,
`9c4a469`. O sync de 77 commits mexeu em **1 arquivo** em produção (`src/router/route-decision.js`)
e para melhor: trouxe a barreira de TTL vencido (`flowExpired`), que impede fluxo expirado de
prender a conversa. Todo o resto já estava idêntico.

Paridade conferida por md5 nos 332 arquivos: **zero divergências reais** (uma acusação foi só
CRLF na cópia local — o `git status` da VPS mente por índice velho e por fim de linha do `scp`).

**O deploy automático voltou a funcionar.** Não depender mais de `scp` manual É a correção.

---

## 3. Data no chat de grupo — CORRIGIDO, e não é a causa do que está queimando

`GROUPCHAT-DATE-SELF-POISONING` (`31f4d72f`): o TOM afirmava data errada e se auto-envenenava —
a fala errada virava linha no histórico e no resumo de longo prazo e voltava no prompt seguinte.
Medido: 11 erros em 26 afirmações (42%), em rajada. **Não era fuso** (+2 dias às 19h, −1 às 10h).
Três bocas fechadas: histórico, memória de longo prazo, e o `group-chat-closing` (que gravava
memória permanente sem nunca saber que dia era hoje).

**No log de 08/08 as datas saíram certas** ("HOJE 08/08 — sáb", "Terça (11/08)"). O fix pegou.

---

## 4. ⚠️ ABERTO — o que está queimando agora (incidente Rose, 08/08 10:43–11:16)

Não é data. São **dois defeitos de execução**, e o segundo é o pior:

**(a) Cancelou o alvo invertido.** Pedido: cancelar os três do dia 30. Ele cancelou os três do
dia **31** (`3aae6ca1`, `59dd0071`, `092501fa`, às 10:51:52) e deixou os do 30 intactos. Há dois
conjuntos com o mesmo assunto — 3 soltas com título longo ("Repasses…: Barra") e 3 filhas de
container com título curto ("Barra") — e ele pegou o conjunto errado.

**(b) Reschedule de container não cascateia para as filhas.** Às 11:16 mexeu só no container
(31/08) e afirmou três vezes ter movido as subtarefas. Elas continuaram em 30/08. A Rose repetiu
"ainda tá 30" e ele insistiu que tinha feito. **Confabulação de execução.**

**Dado já corrigido à mão:** as 3 filhas movidas para 31/08; container e filhas agora no mesmo dia.
As 3 soltas seguem canceladas (eram as duplicatas).

**CORRIGIDO em `9c4a4694`** (KI `GROUPPKG-RESCHEDULE-NO-CASCADE`). O ramo `cancel` já descia para
as filhas; o `reschedule` não tinha a regra, e o `select` nem trazia `is_group`.

Prova end-to-end com LLM real, em grupo descartável `[QA]`, remetente na faixa 5500…, tudo sob
`runInTurn({qa:true})` — nada encostou no grupo da Rose:
- **ANTES: 2/2 reproduziram**, com o TOM dizendo *"Todos os três agora com prazo 31/08. Fechou!"*
  e as filhas em `30/08,30/08,30/08`
- **DEPOIS: 3/3 aprovado**, container e filhas juntos e a fala batendo com o banco

Armadilha registrada: **o dublê dos testes ignora a lista de colunas do `select`** — a falta do
`is_group` passaria VERDE na suíte e só apareceria em produção. Conferido à mão.

Relacionado: `project_group_counters_colapso_pacotes`, `GROUPPKG-CONTAINER-COMPLETABLE-*`.

---

## 5. Também no radar (não perdido, não urgente)

- **`Faturamento Mensal`** foi cancelada por engano no app em 07/08 13:20 (6s antes de concluírem o
  Relatório). Restaurada hoje para `pending`, prazo 08/08. Cancelar tarefa recorrente **apaga o
  futuro** — não gera o próximo mês. Vale confirmação no app, mas é mudança de UI (freeze).
- **`CONFAB-WRITE-DATE-NO-RELLABEL`** (caso Anne, 1:1) — o fix de data foi só do chat de grupo.
- **Token da Hostinger** exposto no chat — rotacionar.
- **6 pastas de grupo atrasadas** — metade é sobra de ciclo.

---

## Ordem sugerida de retomada

1. **Medir a Fatia A** (fecha a Task 7). Alguns dias de log — é o único passo que falta lá.
2. **Crons de governança** — ver seção 6.
3. **Data no 1:1** (`CONFAB-WRITE-DATE-NO-RELLABEL`, caso Anne): o conserto de 07/08 foi só do
   chat de grupo. O 1:1 tem o mesmo padrão e não foi tocado.

## 6. Governança — metodologia acordada em 08/08

👉 **`docs/superpowers/GOVERNANCA-TOM-metodologia.md`** (documento próprio).

Achado que muda a prioridade: **a auditoria das 07h funciona** (357 findings, 2,4% de falso
positivo, roda todo dia). O que não funciona é a FILA — **230 findings (64%) nunca triados, 21
deles severidade alta**, o mais antigo de 21/07. Ela já apontava o problema da Rose semanas
antes de ela reclamar. Não falta instrumento; falta ciclo.

Ordem acordada: **atacar a fila represada → migration de reverificação → 2ª seção no relatório
das 07h → cron de paridade**.

### Crons (a lista original, mantida como referência)

Todo defeito desta sessão era **silencioso** e só apareceu porque uma pessoa reclamou. Regra do
desenho: **cron que só fala quando há problema** — silêncio = tudo bem. Dashboard que ninguém lê
vira ruído, e ruído mata sinal.

| # | Cron | Teria pego | Custo |
|---|---|---|---|
| 1 | Paridade git ↔ produção (VPS atrás? md5 dos 332?) | os 5 dias de deploy morto | baixo |
| 2 | `[GroupChat][DATE-CLAIM]` > 0 nas últimas 24h | a data errada da Rose | baixo (detector já existe) |
| 3 | Molde recorrente que virou `cancelled` | o Faturamento Mensal sumido | baixo |
| 4 | Disse-que-fez × banco não mudou | a cascata do pacote | alto (é o mais valioso) |
| 5 | `TASK_TARGET_AMBIGUOUS` acumulado | insumo da Fatia B | baixo |

Começar por **1, 2 e 3** (baratos, dado já existe). O **4** é o que mais dói e o mais caro —
merece desenho próprio, não improviso.
