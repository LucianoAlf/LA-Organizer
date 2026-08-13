# PAINEL — Grupo / Recorrência / Caso Rose (12/08)

> Chat ÚNICO. Ao voltar, ler **§0 RETOMADA** e seguir. Não abrir chat novo.
> Última atualização: 13/08/2026.

---

## §0 RETOMADA — o que fazer agora

Estado: **raiz achada e provada, fix do vazamento no ar (commit local, deploy SEGURADO)**.

Ordem acordada com o Alf (ele autorizou 1, 2 e 3; a ordem é minha e ele não contestou):

1. ✅ **Guard no PWA contra cancelar molde** — commit `3f8b2e51`. `ehMoldeDeSerie()` em
   `web/src/lib/recurrenceGuard.ts` + guard no `cancelTask` do hook (chokepoint) + mensagem
   que explica o que fazer. 16/16 no guard, 398/398 no PWA.
2. ✅ **`updated_by` em `tasks`** — commit `50011a1a`, migration `add_updated_by_to_tasks`
   APLICADA. Writers preenchidos: PWA `saveTask`/`cancelTask` e o `cancel` do chat de grupo
   (incluindo a cascata pras filhas). ⚠️ **Falta varrer os demais writers** de `tasks` no
   engine (complete, reschedule, edit) — hoje só os caminhos de grupo gravam autoria.
3. **Reparo dos dados** ⛔ **BLOQUEADO — decisão do Alf pendente** (ver §7) — religar os 4 moldes, corrigir filhas-template que ficaram `done`
   por engano, gerar **outubro em diante**, conferir no banco que não nasceu duplicata.
   (Agosto e setembro já existem — não recriar.)
4. ✅ **Simulação no Replay Lab** — `scripts/replay-lab-cenario-grupo-molde.js` (cenário D).
   **5/5 com 5 frases diferentes.** Prova de reversão obtida — ver §9.
5. ✅ **`.deploy-hold` solto** nos dois caminhos; fix NO AR (restart provado `ps -o lstart=`).

**FILA ATUAL:** varrer os writers restantes de `tasks` p/ `updated_by` (engine: complete,
reschedule, edit) · ligar a auditoria nos grupos (§6) · arquitetura de 2 agentes (§6).

---

## §1 A RAIZ (provada, não hipótese)

`filterVisibleGroupTasks` (`src/utils/group-task-visibility.js`) derivava os ids de molde
**do próprio array recebido**. As queries que o alimentam filtram status. Logo:

> **Molde cancelado → some do result set → o conjunto fica sem ele → as filhas-template dele
> vazam pra lista como tarefa real**, mesmo título e mesma data da filha verdadeira, sem
> `recurrence_rule` próprio pra denunciá-las.

**Prova por data:**

| Fato | Quando |
|---|---|
| Molde "Conciliação de Cartões" (dia 30) cancelado | 09/08 **12:54:26 BRT** |
| Rose: "Tom, conclui os dois por favor" | 12/08 21:44 |
| TOM concluiu 10 tarefas erradas antes de acertar as 2 certas | 12/08 21:45–22:05 |

Com o molde vivo o filtro funcionava — por isso o bug só aparecia às vezes e nunca reproduzia.
**Cancelar o molde é o gatilho.**

Confirmação nas linhas: das 3 cópias de "Cartão 8516 (Barra)" de 12/06, duas penduram em
`82ea87e7` e `4f898dce`, que **são moldes**. Só uma era tarefa de verdade.

---

## §2 O QUE JÁ ESTÁ FEITO

Commit `7846c999` — *"fix(grupo): filha-template para de vazar quando o molde é cancelado"*.
**Local, NÃO deployado** (`.deploy-hold` ativo nos dois caminhos).

- `idsDeMoldeDosPais(supabase, tasks)` novo em `src/utils/group-task-visibility.js` —
  resolve os pais **no banco, sem filtro de status**. Best-effort: falha degrada pro
  legado, nunca derruba digest/contexto.
- `filterVisibleGroupTasks(tasks, idsDeMolde)` — 2º parâmetro opcional; **compõe** com os
  ids derivados do array; omitido = comportamento legado (retrocompatível).
- Readers plugados: `src/prompts/system.js:1827` (contexto do TOM — furo MAIOR ali, a query
  é `status='pending'`, então molde `done` E `cancelled` ficavam de fora) e
  `src/services/group-report-builder.js:220` (digest).
- Testes: helper **21/21**. Suíte: **`fail 3` = baseline** (system-loadout,
  group-chat-tasks, pending-intents-detect — env ausente, os de sempre).

---

## §3 O QUE FOI REFUTADO (não repetir)

Diagnósticos meus que o banco derrubou. Registrar para não voltarem:

- ❌ **`UNIQUE (recurrence_parent_id, due_date)`** — não pegaria nada: filha-template tem
  esse campo **nulo**.
- ❌ **"moldes duplicados são a causa"** — o bug acontece com **um molde só**; basta cancelá-lo.
- ❌ **"o resolvedor erra por `due_date ASC`"** — `pickInstanceTarget` já prefere a instância
  cíclica (`cyclic[0] || instances[0]`). Ele só revelou o lixo que a lista entregou.
- ❌ **"o TOM cancelou os moldes"** — descartado com prova (ver §4).
- ⚠️ **`copias > 1` com `sao_molde=1` é DESENHO NORMAL** — `createTaskGroup` cria molde e
  instância do ciclo corrente com a **mesma** `due_date`. Não contar como duplicata.
  (Mesma armadilha de quando quase deletei fatura real achando que era fantasma.)

---

## §4 O CANCELAMENTO DE 09/08 — o que se sabe e o que não

Quatro moldes cancelados no mesmo segundo (**09/08 12:54:26 BRT**, domingo) e duas
instâncias 8s depois:

- `Conciliação de Cartões` (molde dia 30, `4f898dce`) — `is_group=true`
- `Repasses de Cartões - Maquininha: Barra` / `: CG` / `: Recreio` — `is_group=false`, mensais simples

**Não foi o TOM.** Descartado com quatro evidências independentes:
`conversation_history` vazio no horário · `group_chat_messages` vazio · log do engine na VPS
só com ReadReceipts, nenhum `processMessage` · commits do dia todos de governança, à noite.
`scripts/repair-rose-groups.js` é de 12/06 e cancelou **outros** IDs (bate com a limpeza de 24/06).

**Não dá para saber quem foi:** `tasks` tem `created_by`, não tem `updated_by`. É o ponto
cego que o passo 2 fecha.

⚠️ **Fuso:** `updated_at` cru vem em **UTC**. Eu li 15:54 como BRT e perdi uma rodada de
queries. Sempre `at time zone 'America/Sao_Paulo'`.

**Decisão do Alf:** as quatro são recorrentes e **têm que voltar a aparecer todo mês**.

---

## §5 CENÁRIO DO REPLAY LAB — por que o atual não serve

`scripts/replay-lab-cenario-duplicata.js` existe e roda, mas monta fixture de **chat
individual** (`assigned_to`). Deu 0/3, e o 0/3 é **falso**: lendo as falas, o TOM
desambiguou certo ("Nenhuma delas vence hoje — você quis dizer as 3?"), não deu baixa
errada e não mentiu. Vermelho por vacuidade — o irmão do verde por vacuidade.

A fixture certa precisa de: **pacote mensal de GRUPO** (`createTaskGroup` com
`recurrence:'monthly'`) **+ o molde CANCELADO**. Sem cancelar o molde o bug não reproduz.

---

## §6 PENDÊNCIAS FORA DESTA LINHA (não perder)

- Perguntar à Rose se alguém do time cancelou algo no app no **domingo 09/08 por volta do
  meio-dia**. Não é para culpar: se foi clique acidental, o conserto é a tela.
- Auditoria **não enxerga grupos** — `src/services/conversation-audit.js` lê só
  `conversation_history`, nunca `group_chat_messages`. O agente de governança nunca soube
  do caso Rose. Não é falha dele, é falha do sensor.
- Arquitetura de **2 agentes** (auditor ≠ corretor) — o Alf vai trazer o desenho da Maria.
- Buraco de FORMA nº3 do chokepoint (afirmação de ESTADO sem verbo de conclusão).

---

## §7 O ENCERRAMENTO FOI DELIBERADO — reparo bloqueado (13/08)

`series_ended_at` (checado por `shouldMaterializeTemplate`, `src/services/recurrence-guard.js:32`)
é o campo que encerra série de verdade. **Status `cancelled` NÃO para a materialização — esse
campo para.** As quatro séries têm `series_ended_at` preenchido em momentos DIFERENTES e
ANTERIORES ao cancelamento de 09/08:

| Série | `series_ended_at` |
|---|---|
| Repasses Maquininha: Barra e Recreio | 31/07 10:07:28 |
| Repasses Maquininha: CG | 31/07 10:09:42 |
| Conciliação de Cartões | 05/08 22:30:22 |

Três momentos ao longo de uma semana = **decisão deliberada**, não acidente. O cancelamento
de 09/08 foi um SEGUNDO evento, limpando moldes já encerrados.

**Consolidação confirmada nos Repasses:** 31/07 **10:07** encerram as três por unidade;
31/07 **13:07** o molde `Repasses de Cartões - Maquininha` (SEM sufixo) é atualizado e segue
ATIVO, com instância viva em 31/08. Juntaram as três numa só.

**Conciliação de Cartões: sem substituto.** Instâncias só até setembro; nenhum molde ativo
com esse nome ou com os cartões. Em outubro para de nascer.

⚠️ **Eu religuei os 4 moldes para `pending` e revertí tudo** ao descobrir o `series_ended_at`.
O banco está EXATAMENTE como estava. O que salvou foi o `shouldMaterializeTemplate` recusar
com `closed_template` — se ele não existisse, eu teria duplicado os Repasses em cima do
unificado. **Reativar série exige limpar `series_ended_at`, e isso reverte decisão de outra
pessoa: não fazer sem o Alf saber que houve decisão.**

Lição: `status` e `series_ended_at` são eixos SEPARADOS. Ler só o status conta a metade
errada da história.

---

## §8 REPARO EXECUTADO (13/08) — Conciliação de Cartões

**Respostas da Rose (13/08 11:25) derrubaram a §7 pela metade:**
1. Conciliação: *"Precisa voltar todo mes, n sei pq encerrou, era pro Tom só concluir"* — ela NÃO encerrou.
2. Repasses: *"Nao, precisa ter as 3 separadas sim em subtarefas."* — **refuta** minha hipótese de
   consolidação deliberada.
3. Cancelamento de 09/08: não lembra; pediu a lista.

**Repasses: NÃO precisam de reparo.** O molde unificado `c981b7a6` está `pending`, `series_ended_at`
NULL, `is_group=true` e **tem as 3 subtarefas** (Recreio | Barra | CG) — exatamente o que a Rose
descreveu. A limpeza de 31/07 (10:07) foi CERTA: matou os 3 moldes soltos por unidade e deixou o
pacote com as 3 dentro. Contexto no grupo em 31/07: TOM criou 3 duplicadas ao remanejar; a limpeza
as removeu ("já limpei as duplicadas", 10:13).

**Conciliação: reparada.** Molde `4f898dce` → `status=pending`, `series_ended_at=NULL`.

⚠️ **ERRO MEU no meio do reparo, desfeito:** rodei `materializeSeries` e ele criou uma mãe nova
(30/08) com 6 filhas — **duplicando 4 cartões de agosto**. Causa: as mães de agosto (29/08) e
setembro (30/09) tinham sido canceladas em 09/08 12:54:34, mas **as filhas delas seguiam `pending`**
— o dedupe olha as MÃES, não as filhas, então não viu ocupado. Desfeito: cancelei a mãe nova
`373f51d3` + filhas e **reativei** `2fbbe3b6` (29/08) e `e509eaca` (30/09), que é o certo — as
filhas nunca pararam, só as mães tinham sido canceladas.

**Estado final conferido no banco (zero duplicata `(título, due_date)` em aberto):**

| Ciclo | Mãe | Filhas abertas | Filhas feitas |
|---|---|---|---|
| 01/07 | done | 0 | 6 |
| 29/08 | pending | 4 | 2 |
| 30/09 | pending | 6 | 0 |
| Molde | pending, não encerrado | — | outubro+ nasce pelo cron |

**Lição:** cancelar a MÃE não cancela as filhas, e o dedupe do materializador olha só a mãe. Mãe
cancelada + filhas vivas = o materializador acha que o ciclo não existe e recria tudo. Antes de
materializar, conferir se há filhas vivas órfãs de mãe cancelada.

**Quem encerrou a Conciliação em 05/08 22:30:22 continua desconhecido** — 1 linha só (ação pontual,
não script: os lotes de 2-4 linhas são nossos scripts de reparo), sem conversa no grupo nem 1:1.

---

## §9 A RAIZ EXECUTORA — e por que o primeiro fix não bastava (13/08)

O cenário D (`scripts/replay-lab-cenario-grupo-molde.js`) mediu antes/depois e derrubou a
minha própria conclusão:

| Versão | Taxa | Filha-template concluída |
|---|---|---|
| Sem fix nenhum | 1/3 | **2** |
| **Só com o fix da lista (§1/§2)** | **1/3** | **2** ← agulha PARADA |
| Com o fix do SELECT | **5/5** | **0** |

**Segunda raiz:** `pickInstanceTarget` separa filha-INSTÂNCIA de filha-TEMPLATE por
`recurrence_parent_id`. A função sempre esteve certa — os **três** chamadores
(`complete`, `cancel`, `reschedule`) buscavam `.select('id, title, recurrence_rule, is_group')`,
**sem a coluna**. Sem o campo toda linha vem `undefined`, o filtro de ciclo esvazia e cai no
fallback `instances[0]`: a primeira por `due_date`, que EMPATA entre a real e a fantasma.

Reproduzido: `completed=4` existindo 2 alvos. E o `reschedule` cego explica o *"remanejar
criou 3 duplicadas"* dos Repasses em 31/07 — mesmo bug, outra rotina, dois incidentes, uma causa.

**Ler o código não pegaria:** o select e o helper estão a ~370 linhas de distância e cada um,
lido sozinho, parece correto. Só medir pegou.

**Regra que fica:** fix não fecha sem a simulação medir ANTES e DEPOIS. Eu daria o §1/§2 por
fechado — e ele não movia a agulha.
