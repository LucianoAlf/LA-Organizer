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
| 7 | deploy gated + medição | ⛔ **PENDENTE — só falta ligar a flag** |

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

### Como ligar (o que falta)
```bash
ssh tom "cd /opt/LA-Organizer && echo 'TOM_TASK_TARGET_SERIES=1' >> .env && pm2 restart tom"
```
Reverter: tirar a linha e reiniciar. Medir depois pelos logs `[TaskTarget] serie` e
`TASK_TARGET_AMBIGUOUS` em `marker_logs`.

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

## 2. Infra de deploy — CORRIGIDO hoje

`auto-deploy.ps1` saía em `exit 0` quando não tinha o que commitar. Como os dois chats commitam à
mão durante o turno, a árvore chegava limpa e **a etapa que atualiza a VPS nunca rodava**.

Prova: último commit `Auto-deploy` = 03/08 09:15; 66 commits desde então, **zero do hook**; HEAD da
VPS era exatamente esse commit. **A produção ficou 5 dias sem receber git.**

Corrigido em `860295aa`: a sincronização passou a depender do **estado da VPS**
(`git rev-list --count HEAD..origin/main`), não do que o turno commitou.

**Estado:** `.deploy-hold` ATIVO de propósito — o primeiro sync sobe a feature de credenciais do
Hugo, e isso é decisão dele. Na prática o sync mexe em ~4 arquivos: comparei os 332 de
`src/`+`skills/` e 328 já estavam idênticos (mantidos à mão por scp).

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

**Código: NÃO corrigido.** É o próximo alvo, decisão do Alf: atacar a cascata container→filhas na
raiz antes de retomar a Fatia A.

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

1. **Cascata container→filhas** (o que a Rose está sentindo hoje).
2. **Ligar a flag** da Fatia A + medir — está pronto e provado, falta só o momento.
3. Soltar o `.deploy-hold` quando o Hugo confirmar.
