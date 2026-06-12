# Chat de Grupo — Fase 3 (TOM completo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps em checkbox.

**Goal:** TOM completo no chat de grupo — janela deslizante (sai com 8min de silêncio), memória de longo prazo, todas as ferramentas de trabalho seguras (Tarefa✅+Projeto+Evento+Checkpoint+Checklist), papel de facilitador/professor, e card proativo de fechamento de sessão.

**Architecture:** estende a Fase 2 (poll `group-chat-watcher.js`). 100% aditivo no engine: exporta parsers/appliers já existentes (send-free, auditados) + gate `suppressNotify` no único send do evento. `processMessage` do WhatsApp **intacto**.

**Base aprovada:** spec `docs/superpowers/specs/2026-06-12-chat-grupo-fase3-design.md`.

---

## Task 1: Migration — memória de longo prazo + guard de fechamento

**Files:** MCP `apply_migration` name `group_chat_fase3_memory_closing`.

- [ ] **Step 1: Aplicar**
```sql
alter table public.work_groups
  add column if not exists tom_chat_memory text null,
  add column if not exists tom_chat_closed_session_at timestamptz null;
comment on column public.work_groups.tom_chat_memory is 'Chat Fase 3: resumo rolante (memoria longo prazo) do grupo, atualizado a cada fechamento.';
comment on column public.work_groups.tom_chat_closed_session_at is 'Chat Fase 3: guard de idempotencia do card de fechamento (nao re-posta a mesma sessao).';
```
- [ ] **Step 2: Verificar** via `execute_sql`: as 2 colunas existem em `work_groups`.

---

## Task 2: Janela 8min (puro, ajuste + teste)

**Files:** Modify `src/services/group-chat-triggers.js` + `src/services/group-chat-triggers.test.js`.

- [ ] **Step 1:** trocar `const ENGAGE_WINDOW_MIN = 10;` → `= 8;`.
- [ ] **Step 2:** ajustar o teste `isEngaged: janela de 10 min` para 8 (mensagem de 7min atrás = engajado; 9min = não). Rodar `node --test src/services/group-chat-triggers.test.js` → verde.

---

## Task 3: Exportar appliers do engine + gate de notificação do evento

**Files:** Modify `src/engine.js` (APENAS `module.exports` + 1 gate em `applyEventActions`).

**Contexto:** auditoria 12/06 confirmou que `persistProject`, `applyCheckpointBatch`, `applyChecklistAction` são **send-free**; `applyEventActions` tem 1 send condicional (L2492, só quando evento é pra agenda de outra pessoa). Vamos exportar os parsers/appliers faltantes e gatear esse send.

- [ ] **Step 1: Gate no send do evento.** Em `applyEventActions`, assinatura `async function applyEventActions(collaborator, events)` → `async function applyEventActions(collaborator, events, opts = {})`. Na condição do send (hoje `if (eventRecipient && eventRecipient.phone && eventRecipient.id !== collaborator.id) {`) trocar para:
```js
if (!opts.suppressNotify && eventRecipient && eventRecipient.phone && eventRecipient.id !== collaborator.id) {
```
(WhatsApp não passa opts → comportamento inalterado.)

- [ ] **Step 2: Adicionar ao `module.exports`** (final de engine.js) os nomes que faltam:
`parseEventCreateMarker, applyEventActions, parseCheckpointBatchMarker, applyCheckpointBatch, parseChecklistActionMarker, applyChecklistAction`
(já estão exportados: `parseProjectMarker, persistProject, parseTaskUpdateMarker, applyTaskActions, parseEventUpdateMarker, applyEventUpdates`).

- [ ] **Step 3:** `node --check src/engine.js`. E confirmar exports:
`node -e "const e=require('./src/engine'); console.log(['parseEventCreateMarker','applyEventActions','parseCheckpointBatchMarker','applyCheckpointBatch','parseChecklistActionMarker','applyChecklistAction'].map(k=>k+':'+typeof e[k]).join(' '))"`
Esperado: todos `:function`. (require do engine puxa env/clients — se lançar por env faltando, rodar esse check NA VPS via ssh; localmente o `node --check` basta pra sintaxe.)

---

## Task 4: Prompt do grupo — facilitador, memória longa, silêncio, markers novos

**Files:** Modify `src/services/group-chat-prompt.js`.

**Contexto:** o prompt da Fase 2 só ensinava o marker de tarefa. Agora: (a) bloco de memória de longo prazo (`tom_chat_memory`); (b) papel de **facilitador/professor**; (c) regra de **silêncio** (engajado, não responde a toda linha); (d) instruções dos markers de projeto/evento/checkpoint/checklist; (e) consciência do nome **semântico** do grupo.

- [ ] **Step 1:** `buildGroupChatPrompt` ganha o param `longTermMemory` (string|null). Renderizar, logo após o bloco do grupo:
```
## Memória de longo prazo deste grupo
${longTermMemory ? longTermMemory : '(ainda construindo)'}
```
- [ ] **Step 2:** Substituir a seção "## Como agir" por (texto literal):
```
## Como agir (você está ENGAJADO agora)
- O grupo "${groupName}" é semântico: use o tema dele como contexto do que faz sentido criar aqui.
- Você é FACILITADOR, não só executor: conduza, sugira e ENSINE ("é só me falar 'cria projeto X' que eu monto"). Se a equipe parece travada, ofereça o próximo passo.
- NÃO responda a toda mensagem. Responda quando: (a) falarem com você, ou (b) você tiver algo realmente útil/acionável. Se a conversa não é pra você e não há ação, FIQUE EM SILÊNCIO — emita só a tag <<SILENCIO>> e nada mais.
- Fala = persistência: se você disser que criou algo, emita o marker. Nunca confirme sucesso sem o marker.
- Coisas pessoais/financeiras: não é aqui. Foque trabalho do grupo.
```
- [ ] **Step 3:** Substituir o bloco "## Marker de tarefa" pela seção completa de markers (texto literal), cobrindo os 5 (mantendo o formato exato que o engine parseia — copiar a sintaxe dos skills existentes em `skills/` para TASK_UPDATE, PROJECT_CREATE, EVENT, CHECKPOINT_BATCH, CHECKLIST_ACTION). Cada marker com 1 exemplo curto. **Sub-passo de pesquisa obrigatório:** ler os skills reais em `skills/` (ex. grep por `<<PROJECT_CREATE>>`, `<<EVENT`, `<<CHECKPOINT_BATCH>>`, `<<CHECKLIST`) e copiar a sintaxe EXATA que cada parser espera (não inventar campos).
- [ ] **Step 4:** atualizar `group-chat-prompt.test.js`: novos testes garantindo que o prompt inclui PROJECT_CREATE, EVENT, <<SILENCIO>>, e o bloco de memória de longo prazo quando passado. `node --test` verde.

---

## Task 5: Engine do chat — multi-marker + silêncio + memória

**Files:** Modify `src/services/group-chat-engine.js`.

- [ ] **Step 1:** `loadContext` passa a ler também `tom_chat_memory` do grupo (já lê `work_groups`); incluir no `buildGroupChatPrompt({..., longTermMemory: ctx.group.tom_chat_memory})`. Subir `HISTORY_LIMIT` 20→30.
- [ ] **Step 2: Silêncio.** Depois de `ai.chat`, se `reply` (após strip de markers) começar com/for só `<<SILENCIO>>` (ou vazio), **retornar null sem inserir** (a janela desliza no watcher mesmo assim). Strip da tag antes de gravar nos demais casos.
- [ ] **Step 3: Multi-marker.** Após o TASK_UPDATE (Fase 2), processar em sequência — cada um lazy-require do engine, mesmo padrão:
  - `parseProjectMarker` → `persistProject(collab, proj)` → confirma "✅ Projeto X criado".
  - `parseEventCreateMarker` → `applyEventActions(collab, events, { suppressNotify: true })` → confirma.
  - `parseCheckpointBatchMarker` → `applyCheckpointBatch(collab, parsed)` → confirma.
  - `parseChecklistActionMarker` → `applyChecklistAction(collab, parsed)` → confirma.
  - Cada bloco: se malformed → strip + aviso honesto (sem confirmar sucesso falso). Acumular as confirmações numa lista, anexar ao `reply` (igual o padrão de tarefa).
  - **`collab`** = carregar o objeto do remetente (`collaborators` por `senderCollabId`) — `persistProject`/appliers esperam o objeto, não só o id. `loadContext` já busca o sender (nome); estender pra trazer o registro completo (`select('*')`).
- [ ] **Step 3.5:** Export novo `composeAndPersistTomReply` não necessário — manter a gravação role='tom' como na Fase 2.
- [ ] **Step 4:** `node --check`. (e2e real na VPS na Task 8.)

---

## Task 6: Fechamento proativo (idle → card + memória)

**Files:** Create `src/services/group-chat-closing.js`.

**Contexto:** quando um grupo engajado fica idle ≥ 8min, postar UMA vez o card de fechamento (`kind='report'`, HTML), atualizar `tom_chat_memory`, e limpar `tom_chat_engaged_at`. Idempotente via `tom_chat_closed_session_at`.

- [ ] **Step 1: Implementar** `processGroupChatClosing({ supabase, group })`:
  - Guard idempotência: se `group.tom_chat_closed_session_at` é ≥ `group.tom_chat_engaged_at` (já fechou esta sessão) → retornar.
  - Carregar histórico recente do grupo (últimas ~40 msgs desde o engajamento).
  - Montar prompt de fechamento (reusa `loadGroupChatSoul` + um template curto: "a sessão esfriou; gere um RESUMO em HTML simples do que rolou + liste tarefas/decisões em aberto + ofereça transformar em tarefa. Seja conciso."). `ai.chat`.
  - Inserir `group_chat_messages` role='tom', kind='report', content = HTML gerado.
  - Atualizar `work_groups`: `tom_chat_memory` = (memória anterior condensada + novo resumo, limitado a ~3000 chars), `tom_chat_closed_session_at = now()`, `tom_chat_engaged_at = null`.
  - Degrada gracioso (try/catch; nunca lança no watcher).
- [ ] **Step 2:** `node --check`.

---

## Task 7: Watcher — slide da janela + varredura de silêncio

**Files:** Modify `src/realtime/group-chat-watcher.js`.

- [ ] **Step 1: Slide.** Em `processOne`, quando engajado e for rodar o engine (ou mesmo em silêncio), renovar `tom_chat_engaged_at = now()` (a conversa mantém ele na sala). Já setamos no engage; agora também renovar quando `engaged && shouldRun===false` (silêncio engajado) — sliding puro.
- [ ] **Step 2: Varredura de silêncio.** Em `tick`, após processar as mensagens novas, rodar uma sweep barata:
```js
const { data: idleGroups } = await supabaseMain
  .from('work_groups')
  .select('id, name, tom_chat_engaged_at, tom_chat_closed_session_at, tom_chat_memory')
  .not('tom_chat_engaged_at', 'is', null);
for (const g of idleGroups || []) {
  const idleMs = Date.now() - new Date(g.tom_chat_engaged_at).getTime();
  if (idleMs >= 8 * 60 * 1000) {
    try { await processGroupChatClosing({ supabase: supabaseMain, group: g }); }
    catch (e) { console.error('[GroupChat] closing err:', e.message); }
  }
}
```
  (`new Date()`/`Date.now()` OK aqui — é backend Node, não os scripts de workflow.)
- [ ] **Step 3:** import de `processGroupChatClosing`. `node --check`.

---

## Task 8: Deploy + validação e2e (VPS — sessão principal, PARAR antes)

- [ ] **Step 1:** SCP: engine.js, group-chat-{triggers,prompt,engine,closing}.js, group-chat-watcher.js → VPS. `pm2 restart tom`. Confirmar boot limpo (`[GroupChat] Watcher (poll...` + sem stack trace).
- [ ] **Step 2: e2e Financeiro** (inserir msgs role='member' de Ana/Rose):
  - "fala tom, cria um projeto Reforma do Caixa" → projeto criado + confirma.
  - "tom, marca uma reunião amanhã 10h sobre o fechamento" → evento criado (SEM zap — verificar logs que NÃO houve send pra ninguém).
  - janela: conversa de >8min com mensagens a cada poucos min → continua engajado (slide).
  - silêncio 8min → card de fechamento (kind='report') posta UMA vez + `tom_chat_engaged_at`→null + `tom_chat_memory` preenchido. Esperar o sweep.
  - mensagem sem menção, desengajado → silêncio.
- [ ] **Step 3:** Verificar no banco: projeto/evento criados; `group_chat_messages` tem o report; `work_groups.tom_chat_memory` preenchido. Confirmar nos logs que NENHUM `whatsapp.sendMessage` saiu por causa do evento.
- [ ] **Step 4:** Limpar dados de teste (msgs do grupo, projeto/evento criados, resetar colunas tom_chat_* do grupo). Atualizar spec STATUS Fase 3.

---

## Self-Review
- Cobertura: janela 8min deslizante (T2+T7), memória longo prazo (T1+T4+T5+T6), 5 ferramentas seguras (T3+T5, auditadas send-free / evento gateado), facilitador+silêncio (T4), proativo fechamento (T6+T7). ✅
- Risco engine vivo: só `module.exports` += e 1 gate `opts.suppressNotify` (default false). WhatsApp inalterado. ✅
- Sem placeholder: o único "pesquisar antes" é a sintaxe EXATA dos markers (T4 Step 3) — explicitamente um sub-passo de leitura dos skills reais, não invenção.
