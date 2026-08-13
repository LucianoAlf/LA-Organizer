# PAINEL — Grupo / Recorrência / Caso Rose (12/08)

> Chat ÚNICO. Ao voltar, ler **§0 RETOMADA** e seguir. Não abrir chat novo.
> Última atualização: 13/08/2026.

---

## §0 RETOMADA — o que fazer agora

Estado: **raiz achada e provada, fix do vazamento no ar (commit local, deploy SEGURADO)**.

Ordem acordada com o Alf (ele autorizou 1, 2 e 3; a ordem é minha e ele não contestou):

1. **Guard no PWA contra cancelar molde** — `cancelTask` em
   `web/src/hooks/useGroupWorkspace.ts:198` aceita qualquer id, inclusive o molde.
   Cancelar molde mata a série em silêncio. O chat já tem esse guard
   (`pickInstanceTarget`, `src/services/group-chat-tasks.js:83`); o app ficou sem o irmão.
   Encerrar série tem que ser ação deliberada e avisada, nunca efeito de um cancelamento comum.
2. **`updated_by` em `tasks`** — AUTORIZADO pelo Alf (fora do freeze, com palavra dele).
   Migration + preencher no PWA e no engine. Hoje `tasks` só tem `created_by`: não há como
   saber quem cancelou. Foi o que travou a investigação do 09/08.
3. **Reparo dos dados** — religar os 4 moldes, corrigir filhas-template que ficaram `done`
   por engano, gerar **outubro em diante**, conferir no banco que não nasceu duplicata.
   (Agosto e setembro já existem — não recriar.)
4. **Simulação no Replay Lab** — cenário de GRUPO com **molde cancelado** (é o gatilho).
   Sem isso o deploy não sai: regra do Alf de 13/08.
5. **Soltar o `.deploy-hold`** (existe na raiz E em `_remote/`; os dois contam).

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
