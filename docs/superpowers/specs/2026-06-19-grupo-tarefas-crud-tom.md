# Spec — Parte 2 do Grupo-CRUD: Tarefas (editar prazo + encerrar/religar série + aterrar card)

**Data:** 2026-06-19 · **Épico:** Grupo-CRUD Parte 2 de 4 (`memory/project_grupo_crud_roadmap.md`).

## Objetivo
TOM no chat de grupo passa a **reagendar** tarefa, **encerrar série recorrente** (com confirmação, reversível) e **religar** série; e o card de fechamento para de **inventar** o "Em aberto" — passa a listar as tarefas abertas REAIS do grupo.

## Decisões aprovadas (Alf 19/06)
1. **Reatribuir: FORA da Parte 2** (tarefa de grupo segue pool compartilhado).
2. **Encerrar série: confirma antes + reversível** (mesmo padrão do apagar ficha da Parte 1).
3. **Editar é direto** (com eco); só **encerrar série** confirma.

## Princípio de arquitetura (blast radius zero na recorrência)
- **NÃO tocar** `engine.js` / `validateTaskAction` / `VALID_TASK_ACTIONS` / `materializeAll`.
- **Reschedule** reusa o `<<TASK_UPDATE>>` (ação `reschedule` já validada pelo engine; só o applier do grupo a ignorava) → estender `applyGroupChatTaskActions`.
- **Ciclo de série (encerrar/religar)** = **marker novo, group-only** `<<TASK_SERIES>>`, parseado em `group-chat-engine.js` (como TASK_GROUP/GROUP_NOTE), aplicado em `group-chat-tasks.js`. Não passa pelo validador do engine.
- **Confirmação** reusa a tabela `group_chat_pending_confirms` da Parte 1 (op novo `end_series`) + o pré-passo determinístico (`decideConfirm`). **Zero migration nova.**

## Capacidades

### A. Reagendar (editar prazo/lembrete) — `<<TASK_UPDATE>>` `reschedule`
- Estender `applyGroupChatTaskActions` (group-chat-tasks.js): novo ramo `a.action === 'reschedule'`.
- Resolve a tarefa por título no pool do grupo, **mira a INSTÂNCIA visível** (`pickInstanceTarget`, nunca o molde), aplica `due_date`=`new_due_date` e/ou `remind_at`=`new_remind_at`. Echo do que mudou (chip `📅 reagendada`).
- Falha amigável se não achar (`not_found_in_pool`).

### B. Encerrar série (confirma + reversível) — `<<TASK_SERIES>>{action:"end"}`
- `{"action":"end","title":"<série>"}`. O handler **não encerra na hora**: resolve o **molde** da série (helper `resolveSeriesTemplate`: dado o título no grupo, acha a tarefa com `recurrence_rule != null`, ou o molde via `recurrence_parent_id` da instância). Se achou, grava pendência (`op:'end_series'`, `target_id`=molde, summary=título) e o TOM pergunta *"encerrar a série X? para de gerar daqui pra frente — confirma?"* (chip `status:'pending'`).
- **Pré-passo** (estende o da Parte 1): para `op:'end_series'`, no `decideConfirm==='execute'` → **encerra a série** = `status='cancelled'` no molde + `status='cancelled'` nas instâncias **não-done** (corrente + futuras). Responde determinístico "encerrei a série X — não gera mais. Pra voltar: 'religa a série X'". No `cancel` → limpa pendência, "ok, mantive a série".
- Encerrar = molde cancelado → `materializeAll` (Balde A) já pula molde cancelado, então **para de gerar** (comportamento provado). Tarefas done preservadas.

### C. Religar série — `<<TASK_SERIES>>{action:"revive"}`
- `{"action":"revive","title":"<série>"}`. Direto (constructivo, sem confirmar). Resolve o molde **cancelado** por título; reativa (`status='pending'`) e **re-materializa** (`materializeSeries('tasks', molde)` — mesmo helper já usado no dedup-recur do grupo, NÃO é `materializeAll`). Chip `♻️ série religada`.
- É exatamente a recuperação manual que fiz pra Conciliação da Rose, virada em ação.

### D. Aterrar o "Em aberto" do card — `group-chat-closing.js`
- Hoje o "✅ Em aberto" é gerado pela IA a partir do histórico → confabula/contradiz (achado do print: "lista vazia" × card com 3 itens).
- Fix: buscar as tarefas abertas REAIS via `queryGroupTasks(supabase, groupId)` (já existe em group-report-builder.js — MESMA fonte do pool/relatório, exclui done/cancelled/molde) e **injetar como bloco determinístico**. O prompt do card instrui a IA a NÃO inventar "Em aberto" (só faz o "Resumo da sessão" + pendências CONVERSACIONAIS, ex.: "Rose aguarda acesso"); o bloco de TAREFAS abertas é anexado pelo código. Mantém o card espelhando no WhatsApp (HTML→texto no bridge-out).

## Testes (TDD — funções puras primeiro)
- `resolveSeriesTemplate(rows)`: dado candidatos por título, retorna o MOLDE (`recurrence_rule != null`) ou o molde-pai da instância; null se não-recorrente.
- Pré-passo `decideConfirm` já testado (reuso); adicionar caso `op:'end_series'` no roteamento do engine (teste de integração com mock).
- Reschedule no applier: muda due/remind da instância, nunca do molde; not_found.
- Card: o builder do "Em aberto" usa a lista viva (mock de queryGroupTasks) e ignora a confabulação.
- Regressão: `group-chat-tasks`/`group-chat-engine`/`group-report-builder`/`group-chat-prompt`/`group-notes`/`group-chat-bridge-out` continuam verdes.

## Não-objetivos (Parte 2)
- **Editar TÍTULO pelo chat** → fast-follow. Exigiria mexer no `validateTaskAction` compartilhado (risco de recorrência que o Alf pediu pra evitar); o **app já edita título** (GroupTaskSheet). Reagendar cobre o "editar" comum.
- Reatribuir (decisão do Alf: fora).
- Arquivos/finanças (Partes 3–4).
- Tocar `materializeAll`/`engine.js`.

## Deploy & registro
- Backend via `scp tom:` + `pm2 restart`. Sem migration. Validar: testes + smoke ao vivo (série descartável no grupo scratch: criar recorrente → encerrar (confirma) → ver molde+futuras canceladas → religar → ver re-materializado → limpar).
- Known issue `GROUPCHAT-TASKS-CRUD` (+ `GROUPCHAT-CLOSING-EMABERTO-CONFAB` pro card). Atualizar memórias [[project_groupchat_pacote_tarefas]] [[project_recurrence_lifecycle_rootcause]].
