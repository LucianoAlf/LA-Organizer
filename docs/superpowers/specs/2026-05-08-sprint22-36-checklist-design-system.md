# Sprint 22.36 — Checklist Design System + DnD + CRUD + TOM Integration + Agenda Context Fix

**Data:** 2026-05-08
**Origem:** feedback do user na tela /checklists pós Sprint 22.35 + bug do relatório TOM ("não tenho esse dato no contexto atual" pra delegadas).

## 1. Goal

Alinhar a tela `/checklists` ao design system do PWA (igual `/projetos`), introduzir reordenação por drag-and-drop, CRUD ad-hoc de items, integração bidirecional com o TOM (celebração + cobrança + escalação) e corrigir o gap do system prompt que impede o TOM de ler delegadas e estado dos checklists.

## 2. Architecture

Camadas afetadas:
- **PWA** (`web/`): refactor de `ChecklistCard` + `ChecklistItemRow`, novo menu `RowMenu`, integração com `@dnd-kit`, novas mutations.
- **Engine TOM** (`src/`): novos endpoints `/internal/checklist-completed` e `/internal/checklist-incomplete-warning`. Dispatcher ganha bloco `checkChecklistEscalations` (cron 5min). System prompt ganha campos `checklists` e `delegatedTasks` no contexto injetado.
- **DB** (Supabase): migration cumulativa Sprint 22.36 — meta=100, colunas de cobrança, tabela ad-hoc, RLS.

Padrão de comunicação PWA → TOM segue o mesmo de Sprint 22.34 (event-invites/task-delegated): fetch awaited, retorna `NotifyResult`, toast com resultado real.

## 3. Tech Stack

- React 18 + Vite + TypeScript
- TanStack Query (já em uso)
- `@dnd-kit/core` + `@dnd-kit/sortable` (já em uso em outras telas)
- Supabase Realtime + Postgres RLS
- Engine TOM em Node.js + UAZAPI

---

## 4. Fatia 1 — Meta 100% + visual

### Comportamento
- Toda template tem `completion_threshold = 100` (não 80 ou outros).
- Auto-complete só dispara quando 100% dos items estão checked.
- Cor da barra:
  - 0–69% → 🔴 (`bg-danger`)
  - 70–99% → 🟡 (`bg-warning`)
  - 100% → 🟢 (`bg-success`)
- Tick visual do threshold removido (sem o risquinho).
- Linha de status: `5/7 itens (71%)` — sem "meta 80%" ao lado.

### Migration
```sql
UPDATE op_checklists SET completion_threshold = 100;
```

### Arquivos
- `web/src/components/ChecklistCard.tsx` — remover bloco do tick, ajustar `progressTone`, remover " · meta XX%"
- migrations: `2026-05-08-sprint22-36-meta-100.sql`

---

## 5. Fatia 2 — TOM context: delegadas + checklists

### Problema
No Zap o user pediu relatório do dia, TOM respondeu:
> "Sobre tarefas delegadas formalmente (atribuídas a outros colaboradores), não tenho esse dato no contexto atual."

### Causa raiz
`src/prompts/system.js` `buildContext()` injeta `tasks` filtradas por `assigned_to = current_collab_id`. Tarefas que o user **delegou** (`created_by = current_collab_id` AND `assigned_to != current_collab_id`) ficam de fora. Mesmo gap pra checklists do dia.

### Solução
Em `engine.js` (provavelmente em `buildContext` setup, perto do bloco de work tasks today, linha 5283):

1. Adicionar query nova:
```js
const { data: delegatedTasks } = await supabase
  .from('tasks')
  .select('id, title, status, due_date, assigned_to, assignee:collaborators!tasks_assigned_to_fkey(full_name)')
  .eq('created_by', collab.id)
  .neq('assigned_to', collab.id)
  .neq('status', 'done')
  .order('due_date', { ascending: true })
  .limit(20);
```

2. Adicionar query checklists do dia:
```js
const { data: todayChecklists } = await supabase
  .from('op_checklist_completions')
  .select('id, completed_at, dispatched_at, op_checklists(name), op_checklist_item_completions(is_checked, notes)')
  .eq('collaborator_id', collab.id)
  .eq('reference_date', today);
```

3. Em `system.js:171` `buildContext()` adicionar parâmetros `delegatedTasks` e `checklists` e renderizar bloco:
```
DELEGADAS (tarefas que você atribuiu pra outros):
- Rafinha: "verificar bancos de bateria" — vence 09/05 — pendente
- Quintela: "responder e-mail Henrique" — vence hoje — pendente

CHECKLISTS DE HOJE:
- Abertura Escola: 5/7 (71%) — observação no item 4: "ar não ligou"
- Limpeza: 100% (concluído 17:30)
```

### Arquivos
- `src/prompts/system.js`: nova função `renderDelegatedTasks()`, `renderTodayChecklists()`. Atualizar assinatura `buildContext`.
- `src/engine.js`: queries adicionais antes do `buildContext` call.

### Testes
- Pergunta no Zap "como tá meu dia, incluindo delegadas?" → TOM lista delegadas com nome + status.
- "como tá meu checklist hoje?" → TOM lista por nome com %.

---

## 6. Fatia 3 — Refactor card pro design system

### Comportamento
Card colapsável + ⋮ menu + estrutura igual a `ProjectCard`.

### UI alvo (mirror `/projetos`)
```
┌─ ChecklistCard ─────────────────────────────────────┐
│  [▼] Abertura Escola              ⋮  ✅ Completo   │
│      0/7 itens (0%)                                 │
│      [progress bar dinâmica]                        │
│ ─ items ─                                           │
│  ⋮⋮ ☐ 1. Abrir portões e recepção             ⋮     │
│  ⋮⋮ ☐ 2. Ligar sistemas de som               ⋮     │
│  ...                                                │
│  ─                                                  │
│  + Item                                             │
└─────────────────────────────────────────────────────┘
```

- Click no header (chevron ▼) toggle expand/collapse. Estado em localStorage `checklist:collapsed:<id>`.
- Cards começam **expandidos** (mantém comportamento atual). Quando completo, auto-colapsa (UX cue).
- ⋮ menu do CARD: "Editar template" (coord/dir only, abre `/mais/checklists-templates?focus=<id>`), "Histórico" (futuro).
- ⋮ menu do ITEM (substitui ícones inline `MessageSquarePlus` + `ListTodo` da Sprint 22.35):
  - Adicionar/editar observação
  - Criar tarefa
  - Apagar (só items ad-hoc)
- Drag handle ⋮⋮ visível só quando expandido E não readonly.

### Componentes novos/modificados
- `web/src/components/ChecklistCard.tsx` — adicionar collapse state, header clickable, RowMenu integration
- `web/src/components/ChecklistItemRow.tsx` — adicionar drag handle, RowMenu, remover botões inline
- `web/src/components/ChecklistRowMenu.tsx` (NOVO) — equivalente menu portal pra items

### Persistência colapsado
```ts
const [collapsed, setCollapsed] = useState(
  () => localStorage.getItem(`checklist:collapsed:${completion.id}`) === '1'
);
useEffect(() => {
  localStorage.setItem(`checklist:collapsed:${completion.id}`, collapsed ? '1' : '0');
}, [collapsed, completion.id]);
```

---

## 7. Fatia 4 — Drag and drop reorder per-user

### Comportamento
Cada colaborador reordena items pra seu jeito sem mexer no template global.

### Schema
```sql
ALTER TABLE op_checklist_item_completions
  ADD COLUMN user_sort_order INTEGER;
```

`NULL` = usar `op_checklist_items.sort_order` (default do template).
Valor preenchido = override per-instance.

### UI
- `@dnd-kit/sortable` com handle `⋮⋮` (`<GripVertical />`).
- Ao soltar: bulk update via mutation com 1 round-trip:
```ts
await supabase.rpc('reorder_checklist_items', {
  completion_id: completion.id,
  ordered_item_ids: newOrder
});
```
Ou alternativa simples: N upserts em paralelo (pode ser ok pra ≤ 20 items).

### Render
```ts
const sorted = [...items].sort((a, b) => {
  const orderA = itemCompletions.find(c => c.item_id === a.id)?.user_sort_order
    ?? a.sort_order;
  const orderB = itemCompletions.find(c => c.item_id === b.id)?.user_sort_order
    ?? b.sort_order;
  return orderA - orderB;
});
```

### Readonly
DnD desabilitado quando checklist está completo ou janela fechada.

---

## 8. Fatia 5 — CRUD ad-hoc items

### Schema
```sql
CREATE TABLE op_checklist_completion_extra_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id UUID NOT NULL REFERENCES op_checklist_completions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  is_checked BOOLEAN DEFAULT false,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES collaborators(id)
);

ALTER TABLE op_checklist_completion_extra_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_crud_own_extra_items
  ON op_checklist_completion_extra_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_completion_extra_items.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  );
```

### UI
- "+ Item" no rodapé do card (quando expandido + não readonly) → input inline com Enter pra salvar
- Items ad-hoc renderizam misturados na lista (sort por `sort_order`); diferenciam visualmente com badge "ad-hoc" pequeno
- ⋮ menu do item ad-hoc inclui "Apagar" (items do template não)
- Toggle/notes/criar-tarefa funcionam igual aos items do template

### Cálculo de progresso
- Items ad-hoc COUNT pra denominador. 5 do template + 2 ad-hoc = denominador 7.
- 100% = todos os 7 marcados.

### Auto-complete + TOM
Funcionam normalmente — Fatia 6 dispara igual.

---

## 9. Fatia 6 — TOM celebra + cobra + escala

### 9.1 Quando user fecha 100% (PWA → TOM)

**Trigger:** mutation no PWA detecta `newPct === 100` E `!completed_at`. Após `UPDATE op_checklist_completions SET completed_at = NOW()`, chama:

```ts
await fetch(`${TOM_API_BASE}/internal/checklist-completed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-secret': SECRET },
  body: JSON.stringify({ completion_id: completion.id })
});
```

**Endpoint** (engine, `src/internal-api.js`):
1. Busca completion + collaborator + template + manager.
2. Dispara 2 Zaps:
   - Pro **colaborador**: `🎉 Fechado! *<template.name>* 100%. Mandei aviso pro <manager.full_name>.`
   - Pro **gerente**: `✅ *<collab.full_name>* fechou o checklist *<template.name>* na unidade *<unit>*. 100%, sem pendência.`
3. Marca em `marker_logs` (`result: 'executed'`, marker_type: `checklist_completed`).

### 9.2 Quando janela fecha (6h após dispatch) sem 100% (cron-driven)

**Cron:** novo bloco `checkChecklistEscalations` no `dispatcher.js`, roda a cada 5min.

```js
async function checkChecklistEscalations(now = new Date()) {
  // Phase 1: enviar cobrança ao colaborador (1x quando janela vence)
  const { data: needsReminder } = await supabase
    .from('op_checklist_completions')
    .select('id, dispatched_at, collaborator_id, op_checklists(name, unit)')
    .is('completed_at', null)
    .is('reminded_at', null)
    .lte('dispatched_at', new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString());

  for (const c of (needsReminder || [])) {
    // Conta items pendentes
    const { data: items } = await supabase
      .from('op_checklist_item_completions')
      .select('is_checked')
      .eq('completion_id', c.id);
    const pending = (items || []).filter(i => !i.is_checked).length;
    if (pending === 0) continue; // bateu 100% mas completed_at não foi gravado — pular

    // Envia cobrança
    await sendWhatsapp(c.collaborator.phone,
      `Oi ${c.collaborator.full_name}, vi que faltam ${pending} itens no checklist *${c.op_checklists.name}* de hoje. Tudo certo? Conseguiu fazer?`
    );
    await supabase.from('op_checklist_completions').update({ reminded_at: now.toISOString() }).eq('id', c.id);
  }

  // Phase 2: escalar pro gerente se passou 20min sem resposta
  const { data: needsEscalation } = await supabase
    .from('op_checklist_completions')
    .select('id, reminded_at, reminder_replied, collaborator_id, op_checklists(name, unit)')
    .not('reminded_at', 'is', null)
    .eq('reminder_replied', false)
    .is('escalated_at', null)
    .lte('reminded_at', new Date(now.getTime() - 20 * 60 * 1000).toISOString());

  for (const c of (needsEscalation || [])) {
    const manager = await findUnitManager(c.op_checklists.unit);
    if (!manager) continue;
    const { data: items } = await supabase
      .from('op_checklist_item_completions')
      .select('is_checked')
      .eq('completion_id', c.id);
    const pending = (items || []).filter(i => !i.is_checked).length;

    await sendWhatsapp(manager.phone,
      `⚠️ *${collab.full_name}* não fechou o checklist *${c.op_checklists.name}* (faltaram ${pending} itens) e não respondeu cobrança em 20min.`
    );
    await supabase.from('op_checklist_completions').update({ escalated_at: now.toISOString() }).eq('id', c.id);
  }
}
```

### 9.3 Como TOM detecta resposta da cobrança
Engine já marca `marker_logs` quando processa CHECKLIST_ACTION. Quando o colab responde com `check_items` ou `check_all` ou `add_note` num completion que tem `reminded_at IS NOT NULL`, atualizar `reminder_replied = true` no mesmo update. Implementar em `processChecklistAction` no engine.

### 9.4 Helper findUnitManager
```js
async function findUnitManager(unit) {
  // 1. Coordinator dessa unidade ativa?
  const { data: coord } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('role', 'coordinator')
    .eq('unit', unit)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (coord) return coord;

  // 2. Fallback: director ativo (unit='all')
  const { data: director } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('role', 'director')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return director;
}
```

### 9.5 Schema
```sql
ALTER TABLE op_checklist_completions
  ADD COLUMN reminded_at      TIMESTAMPTZ,
  ADD COLUMN reminder_replied BOOLEAN DEFAULT FALSE,
  ADD COLUMN escalated_at     TIMESTAMPTZ;

-- Marker_logs result type já aceita executed/rejected/skipped/redirected (Sprint 22.34l)
```

### 9.6 Idempotência
- `marker_logs` previne envio duplicado por evento (chave `<completion_id>:<event>`).
- `reminded_at IS NULL` filtro garante 1 cobrança só.
- `escalated_at IS NULL` filtro garante 1 escalação só.

---

## 10. Migrations consolidadas (1 arquivo Sprint 22.36)

```sql
-- migrations/2026-05-08-sprint22-36.sql

-- 1. Meta 100%
UPDATE op_checklists SET completion_threshold = 100;

-- 2. Reorder per-user
ALTER TABLE op_checklist_item_completions
  ADD COLUMN user_sort_order INTEGER;

-- 3. Items ad-hoc
CREATE TABLE op_checklist_completion_extra_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id UUID NOT NULL REFERENCES op_checklist_completions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  is_checked BOOLEAN DEFAULT false,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES collaborators(id)
);
ALTER TABLE op_checklist_completion_extra_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_crud_own_extra_items
  ON op_checklist_completion_extra_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_completion_extra_items.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  );

-- 4. Cobrança/escalação
ALTER TABLE op_checklist_completions
  ADD COLUMN reminded_at      TIMESTAMPTZ,
  ADD COLUMN reminder_replied BOOLEAN DEFAULT FALSE,
  ADD COLUMN escalated_at     TIMESTAMPTZ;

-- 5. Função findUnitManager (alternativa SQL pura, opcional)
-- (engine implementa em JS, sem precisar dessa função)
```

---

## 11. Arquivos afetados (resumo)

### PWA (`web/`)
- `web/src/screens/Checklists.tsx` — sem grandes mudanças, integra ErrorState (já tem)
- `web/src/components/ChecklistCard.tsx` — refactor (collapse, ⋮ menu, "+ Item", remove tick, dispara `/internal/checklist-completed`)
- `web/src/components/ChecklistItemRow.tsx` — refactor (drag handle, RowMenu, remove botões inline)
- `web/src/components/ChecklistRowMenu.tsx` (NOVO) — menu portal
- `web/src/components/ChecklistAddItemForm.tsx` (NOVO) — input inline pra ad-hoc
- `web/src/lib/tomEngine.ts` — adicionar `notifyChecklistCompleted(completionId)`
- `web/src/types.ts` — adicionar `OpChecklistCompletionExtraItem` + campos novos em `OpChecklistItemCompletion` (user_sort_order)

### Engine (`src/`)
- `src/internal-api.js` — novo endpoint `/internal/checklist-completed`
- `src/rituals/dispatcher.js` — novo bloco `checkChecklistEscalations` + chamada a cada tick
- `src/engine.js` — `processChecklistAction` marca `reminder_replied`; queries adicionais pra context (delegated/checklists)
- `src/prompts/system.js` — `buildContext` aceita `delegatedTasks` + `checklists`, renderiza blocos novos

### Migrations
- `migrations/2026-05-08-sprint22-36.sql`

### Documentação
- `docs/06-prd-la-organizer-v3.md` — bump v3.9 com changelog
- `docs/05-mapa-telas-pwa-v3.md` — v3.5
- `docs/TOM-SKILLS-CATALOG.md` — bloco novo na skill `checklists-operacionais`

---

## 12. Critérios de sucesso

- [ ] Templates todos com `completion_threshold = 100` no banco
- [ ] Barra dinâmica: 0–69 vermelho, 70–99 amarelo, 100 verde. Sem tick.
- [ ] Click no header colapsa/expande. Estado persiste em localStorage.
- [ ] ⋮ no card abre menu (Editar template / Histórico)
- [ ] Drag handle ⋮⋮ funciona quando expandido + não readonly. Reorder persiste em `user_sort_order` per-instance.
- [ ] "+ Item" cria item ad-hoc; só apaga via ⋮.
- [ ] Marcar todos os items (template + ad-hoc) → 100% → toast "🎉" no PWA + Zap pro user + Zap pro gerente.
- [ ] Janela fecha (6h após dispatch) com pendência → cron envia cobrança 1x ao colab.
- [ ] Colab responde no Zap → marker action atualiza `reminder_replied=true`, escalação cancelada.
- [ ] Colab não responde 20min → cron envia escalação ao gerente da unidade. Director fallback se sem coord.
- [ ] TOM responde "como tá meu dia, com delegadas" mostrando lista de delegadas + status.
- [ ] TOM responde "como tá meu checklist hoje" listando por nome + %.

---

## 13. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Delegadas no contexto explodem token count se user delega muita coisa | LIMIT 20, ordenar por due_date asc, só não-done |
| DnD reorder com lag (N upserts) | Mutation otimista + 1 RPC bulk se ficar lento |
| Cobrança/escalação dispara em horário noturno | Cron filtra por hora local (8h-22h America/Sao_Paulo) |
| Items ad-hoc perdem ordenação se misturados com template | sort: items[].user_sort_order ?? items[].sort_order, ad-hoc usa sort_order próprio (default 9999) |
| Manager errado se unit='all' do template | findUnitManager fallback pra director |
| Loop de notificação se PWA marca completed_at e endpoint marca outra vez | endpoint só dispara Zap, não atualiza completed_at; PWA é fonte de verdade |
| User edita template (coord) e quebra completions em andamento | items deletados continuam visíveis nos completions (via op_checklist_items), itens novos não aparecem em completions já criadas hoje (esperado) |

---

## 14. Não está no escopo (Sprint 22.37+)

- Aderência semanal pra coord/director (tela `/mais/aderencia-checklists`)
- Histórico de execução por colaborador
- Checklist com itens condicionais (skip if X)
- Override de threshold por instância (todos passam pra 100, sem exceção)
- Lembretes silenciosos por hora do dia (mantém só janela 6h após dispatch)
- DnD entre cards diferentes (só dentro do mesmo card)

---

## 15. Ordem de execução proposta

1. **Migrations** (10 min) — aplicar via supabase MCP
2. **Fatia 2** — TOM context delegadas + checklists (~1h, sem UI, mas resolve bug crítico do relatório)
3. **Fatia 1** — Meta 100 + cor + remoção tick (~15 min)
4. **Fatia 3** — Refactor card design system + colapsável (~2h)
5. **Fatia 4** — Drag and drop (~1.5h)
6. **Fatia 5** — CRUD ad-hoc items (~2h)
7. **Fatia 6** — TOM celebra/cobra/escala (~3h)

Total estimado: ~10h, em sessões de 2h cada.

Cada fatia: commit + push + deploy no fim. Permite testes incrementais.
