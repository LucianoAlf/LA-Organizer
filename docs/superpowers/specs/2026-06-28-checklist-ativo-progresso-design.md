# Checklist ativo — TOM enxerga e comunica o progresso da delegada (design)

**Data:** 2026-06-28
**Autor:** Catraca (chat revisor/PWA) + Alf
**Status:** design aprovado pelo Alf (aguardando review do spec → writing-plans)

> **Para executores:** próximo passo é `superpowers:writing-plans`. Este é o design; o plano detalhado (file:line, TDD step-by-step) vem depois.

**Goal:** Fazer o checklist (subtarefa via `parent_task_id`) que já existe nas tarefas virar visível e ativo na comunicação do TOM: mostrar progresso `X/N` + barra na cobrança/briefing pro executor **e** pro delegador, e fazer a conclusão de todos os itens auto-concluir a tarefa-pai (disparando o aviso ao delegador e parando a cobrança).

**Arquitetura:** um helper puro determinístico monta o bloco de progresso (formato exato), injetado em 2 superfícies (alerta de atrasada determinístico = byte-exato; briefing LLM = fiel). Uma "ponte" de cascade (todas as filhas done → pai done) roda nos 2 caminhos de marcação (PWA e TOM) e reusa a notificação ao criador que já existe. Zero migration.

**Tech stack:** Node.js/CommonJS (engine `src/`), React+TS+Supabase (PWA `web/`), helpers puros com vitest/node:test (TDD).

## Global Constraints (copiar verbatim em todo task do plano)

- **Voz/tom/tamanho do TOM são SAGRADOS.** O bloco de progresso é **dado determinístico** injetado — NÃO muda o jeito que o TOM fala. Otimização só em infra/dados.
- **Zero migration.** `parent_task_id`, `status`, `completed_at`, `completed_by` já existem.
- **Zero-regressão.** Não regredir: listas de topo (filhas escondidas, `parent_task_id IS NULL`), checklist de grupo, `op_checklists` (módulo separado — NÃO tocar, NÃO fundir).
- **Catraca/TDD.** Helpers puros primeiro, com teste. Verificar no BANCO/artefato real, nunca na palavra.
- **`.deploy-hold`** na raiz ANTES de editar `src/` (multi-chat: o outro chat é dono do `engine.js`). Coordenar o deploy do engine.
- **Anti-confab.** Telemetria/marker reais; o que o TOM disser que fez tem que bater com o banco.

---

## 1. Problema & motivação

Caso do Jonathan (print no zap): a tarefa delegada "Ligar para aluno" tem um checklist de 5 itens; o John fez 4. A tarefa está "atrasada 2 dias", mas a cobrança do TOM é **cega** ao progresso — não conta que falta só 1. E quando o John fecha tudo, ninguém é avisado de forma proativa via o caminho do checklist.

Quatro pedidos do Alf:
1. Progresso (`X/N` + barra) na cobrança/briefing.
2. Ao concluir TODOS os itens → avisar o delegador.
3. Avisar o executor + **parar** a cobrança ao concluir (pros dois).
4. Barra de progresso na UI do PWA, reaproveitável na mensagem do TOM.

Princípio do Jonathan que rege tudo: **"o TOM não envia spam — só inclui mais informação na mensagem que já existe."** (O "spam" temido era 1 mensagem por item marcado — isso NÃO se faz; o checklist inteiro vai dentro de mensagens que já existem.)

## 2. Decisões (resultado do brainstorm)

| # | Decisão | Escolha |
|---|---|---|
| Q1 | O que "concluído" significa com checklist | **Cascade**: marcar a última filha → pai vira `done` sozinho (SÓ pra tarefa COM checklist; sem checklist segue manual). |
| Q2 | Quem vê o progresso | **Os dois**: executor (na seção dele) e delegador (na seção *Delegadas* dele). |
| Q3 | Quanto do checklist mostrar | **Completo sempre** (todos os itens) — não é spam porque vai numa mensagem só. |
| Arq | Garantia de formato | Bloco **determinístico** (helper puro). Byte-exato no alerta de atrasada; fiel (LLM) no briefing. |
| D1 | Escopo do bloco | **Toda** tarefa com checklist (pessoal/delegada/grupo). Cascade auto-conclui o pai em todas; notificação ao delegador só dispara em delegada (`created_by != assigned_to`). |
| D2 | Confirmar pro executor ao concluir | **Sim** ("✅ você fechou: <tarefa> (5/5)"). |
| D3 | Desmarcar item após auto-conclusão | **Reabre** o pai (`status→pending`), **sem** notificar ninguém. |

## 3. Estado atual (conferido no código — 2026-06-28)

**Já existe (reusar):**
- Seção **Delegadas** no briefing: `src/prompts/system.js:647-657` — `delegatedTasks` (`created_by = pessoa AND assigned_to != pessoa`, abertas), renderiza `• <assignee>: "<title>" — vence <data> — <status>`. **É o veículo do delegador.**
- Listas do executor: `system.js:470-476` (pessoais/trabalho hoje).
- Notificação ao criador: `src/engine.js:4049-4088` `notifyTaskCreatorOfAction(task, actor, action, detail)` — em `action:'complete'` manda `✅ <criador>, o <executor> concluiu a tarefa que você pediu:\n_"<title>"_`; guard `created_by===assigned_to` retorna. **É o payoff.**
- Helper PWA de progresso: `web/src/lib/taskChecklist.ts` — `splitTopLevel`, `checklistProgress(children)→{done,total}` (cancelled fora do total), `canCheckItem`.
- Infra PWA→engine: `web/src/lib/tomEngine.ts` (`/internal/*`, `notifyTaskUpdated`, `notifyTaskDelegated`); padrão de 100% já usado em `web/src/components/ChecklistCard.tsx` (`/internal/checklist-completed`, op_checklists).
- Alerta de atrasada determinístico: `src/rituals/dispatcher.js` `checkOverdueAlerts` + `buildOverdueText(title, n, quiet)` (template direto, sem LLM). Destinatário hoje: só `assigned_to`.
- Subtarefas: `src/services/subtasks.js` `createSubtasks({...})` — filhas herdam `context/assigned_to/assigned_group_id` do pai; 1 nível (recusa filho-de-filho).

**NÃO existe (trabalho novo):**
- **Cascade** (todas as filhas done → pai done): não há em lugar nenhum (PWA `useTaskChecklist.toggleItem` e engine só atualizam a filha).
- **"TOM marca item"**: o marker só faz `create` com `subtasks:[...]` (`engine.js:4954`). Falta ação `mark-item`/`add-item`.
- **Progresso no texto** da cobrança/briefing: `buildOverdueText` e a seção Delegadas não olham filhas.
- **Barra visual** no PWA: hoje é só o número `4/5` (`TaskChecklistSection.tsx:47`).
- **Notificação do delegador a partir do app** na conclusão: `notifyTaskUpdated` cobre 'edited'/'rescheduled'; falta o disparo de 'complete' → criador.

**Distinção importante:** `op_checklists` (módulo "Checklists", bloco `system.js:660-678`) é OUTRO conceito (checklist operacional template). NÃO é o subtask checklist. Coexistem; fusão fica fora de escopo.

## 4. Componentes

### 4.1 Helper determinístico `renderChecklistBlock` (puro, TDD)
- **PWA:** `web/src/lib/taskChecklist.ts` — adicionar `renderChecklistBlock(children, opts)` reusando `checklistProgress`.
- **Engine:** espelho em `src/services/` (ex. `subtasks.js` ou `checklist-render.js`) — mesma lógica/saída.
- **Saída (formato exato):**
  ```
  *Checklist* John: 4/5 ▓▓▓▓░
  ✅ Mensagem enviada para o aluno
  ✅ Aluno respondeu
  ✅ Aluno pagou a mensalidade
  ✅ Trancamento do aluno realizado
  ⬜ Confirmar matrícula
  ```
- **Label viewer-aware:** delegador vê `*Checklist* <NomeExecutor>:`; o próprio executor vê `*Checklist:*` (sem nome). `opts.viewer` decide.
- **Barra:** `▓`×done + `░`×(total-done); nº de segmentos = `min(total, 10)`; se `total>10`, escala proporcional (round). `cancelled` fora do total (já em `checklistProgress`).
- **Ordem dos itens:** `sort_position` asc; feitos com `✅`, abertos com `⬜`.

### 4.2 Cascade — `shouldAutocompleteParent(children)` (puro, TDD)
- Retorna `true` sse `total>0` e todas (exceto `cancelled`) estão `done`.
- Acionado nos **2 caminhos**:
  - **PWA:** após `useTaskChecklist.toggleItem` marcar a filha, recarrega irmãs; se 100% → completa o pai (`status:'done', completed_at, completed_by`) → chama o endpoint da ponte (4.3). Se desmarcar e estava 100% → reabre o pai (`status:'pending', completed_at:null, completed_by:null`), sem notificar.
  - **Engine/TOM:** a ação `mark-item` (novo, 4.4) faz a mesma checagem; ao auto-concluir, chama `notifyTaskCreatorOfAction(parent, actor, 'complete')`.

### 4.3 Ponte app→delegador (reusa padrão `/internal/`)
- Novo endpoint interno (ex. `/internal/subtask-cascade-complete` ou estender `notifyTaskUpdated` p/ aceitar `'completed'`) que, dado o `parentId` + ator, chama `notifyTaskCreatorOfAction(parent, actor, 'complete')` (delegador) e, se D2, manda a confirmação ao executor.
- Mecanismo exato (endpoint novo vs estender `task-cobrar`-style) decidido no plano; padrão já existe em `tomEngine.ts` + handlers `/internal/*` no engine.

### 4.4 Marker `mark-item` (engine, TDD)
- Estender o parser de `<<TASK_UPDATE>>`/`<<TASK>>` com ação de marcar/desmarcar uma filha do checklist (por id ou por texto), reusando `createSubtasks` como vizinho. Ao marcar → roda 4.2 (cascade) → 4.3 (notifica).
- Anti-confab: só loga/afirma "concluído" se o banco confirmar (rowcount); chokepoint vigente.

### 4.5 Injeção do bloco nas mensagens
- **Alerta de atrasada (byte-exato):** em `checkOverdueAlerts`/`buildOverdueText`, anexar `renderChecklistBlock` quando a tarefa tem filhas. Determinístico → formato garantido.
- **Briefing (LLM, fiel):** anexar o bloco (string pronta) ao contexto nas seções do executor (`system.js:470-476`) e na seção *Delegadas* (`system.js:649-657`), + instrução mínima no prompt `briefing_diario` p/ emitir o bloco **verbatim**. (TOM já renderiza dados estruturados com fidelidade — lembretes, RSVP, contadores.)
- **Dados:** os loaders de tarefas/delegadas precisam anexar as filhas (ou o `{done,total}` + itens) por pai. Hoje o topo esconde filhas; aqui carregamos as filhas SÓ para compor o bloco.

### 4.6 UI — barra de progresso (PWA)
- Componente de barra visual (`▓▓▓▓░` ou barra real com tokens do DS) em `TaskChecklistSection.tsx` (hoje só `4/5`) + badge na linha da agenda. Reusa `checklistProgress`.

## 5. Fluxo de conclusão
John marca a última filha (app **ou** TOM) → `shouldAutocompleteParent` = true → pai vira `done` (`completed_at/by`) → ponte chama `notifyTaskCreatorOfAction(parent, John, 'complete')` → Anna recebe `✅ Anna, o John concluiu...` + (D2) John recebe `✅ você fechou: Ligar para aluno (5/5)` → cobrança para (pai sai do filtro `status not in (done,cancelled)`).

## 6. Casos de borda
- **Desmarcar** após auto-conclusão → pai reabre (`pending`), sem notificar (D3).
- Tarefa **sem** checklist → comportamento atual (manual, sem bloco).
- `N>10` → barra escala (cap 10 segmentos).
- Item **cancelado** → fora do total.
- Conclusão **manual** do pai com itens abertos → permitida (done fecha tudo); não força marcar filhas.
- 1 nível só (já garantido por `createSubtasks`).
- Pai de **grupo** com checklist: cascade auto-conclui; sem delegador → sem `notifyTaskCreatorOfAction` (guard). Não regredir `filterVisibleGroupTasks`.

## 7. O que NÃO muda (proteções)
- Voz/tom/tamanho do TOM (bloco é dado, não fala).
- `op_checklists` (módulo separado) intacto.
- Listas de topo (filhas escondidas) intactas.
- Zero migration.

## 8. Riscos & decisões pro plano
- **Briefing é LLM** → o bloco no briefing é *fiel*, não byte-garantido. Mitigação: instrução verbatim + o alerta de atrasada (determinístico) é o carrier exato. Se houver drift observável no briefing, fallback é tornar a montagem da linha de tarefa determinística (não necessário agora).
- **Endpoint da ponte:** novo vs estender — decidir no plano (padrão `/internal/*` já existe).
- **Coordenação multi-chat:** `engine.js`/`dispatcher.js`/`system.js` são do outro chat → `.deploy-hold` + coordenar antes de editar `src/`. PWA (`web/`) é deste chat.
- **Carga de filhas no contexto:** C (completo sempre) é decisão do Alf. Medir o custo de tokens no briefing quando alguém tem muitas tarefas com checklist; se virar problema real de tamanho, **levar de volta pro Alf** — não cortar por conta própria (decisão/voz dele).

## 9. Testes
- **Puros (TDD):** `renderChecklistBlock` (formato, viewer-aware, N grande, cancelado, ordem) + `shouldAutocompleteParent` (100%/parcial/vazio/1 item/todos cancelados).
- **Integração:** cascade PWA **e** TOM → `notifyTaskCreatorOfAction` dispara 1x; cobrança para; desmarcar reabre sem notificar; D2 manda confirmação ao executor.
- **E2E preview (localhost:4173):** criar delegada com 5 itens → bloco aparece (read-view + barra) → marcar 4 → `4/5 ▓▓▓▓░` → marcar o 5º → pai conclui + (dry-run/log) aviso ao delegador. Usar ficha descartável (preview bate produção).

## 10. Fora de escopo (fatias futuras)
- Fundir/absorver o módulo `op_checklists` (rota /checklists).
- Checklist em compromisso/evento (pauta).
- Visão proativa extra do delegador além do briefing/Delegadas (digest novo).
