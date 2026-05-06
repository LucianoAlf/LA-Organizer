# Checklists Operacionais Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar checklists operacionais diários (abertura, fechamento, fiscalização, limpeza) com dispatch via WhatsApp + marcação no PWA, fonte única no DB, threshold de aderência configurável.

**Architecture:** Cron em `dispatcher.js` detecta templates cujo `dispatch_time` caiu na janela dos últimos 5 min, cria `op_checklist_completions` e envia WhatsApp numerado. Colaborador responde → TOM parseia → engine aplica `<<CHECKLIST_ACTION>><<END>>` → DB. PWA em `/checklists` lê a mesma tabela com realtime Supabase. Janela de 6h; itens fora marcados `late=true`.

**Tech Stack:** Node.js (backend), Supabase (PostgreSQL + Realtime), React + TypeScript + TanStack Query (PWA), lucide-react (ícones), whatsapp.sendMessage (UAZAPI wrapper)

**Spec:** `docs/superpowers/specs/2026-04-29-checklists-operacionais-design.md`

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/` (via MCP) | CREATE | 5 novas colunas + 2 unique constraints |
| `src/engine.js` | MODIFY | `parseChecklistActionMarker` + `applyChecklistAction` |
| `src/prompts/system.js` | MODIFY | `getActiveChecklistHint` + `<<CHECKLIST_ACTION>>` em valid markers |
| `src/rituals/dispatcher.js` | MODIFY | `dispatchChecklists(now, opts)` + call no `run()` |
| `skills/checklist-tarefas.md` | MODIFY | Seção Operacional: parsing + marker schema |
| `web/src/types.ts` | MODIFY | `OpChecklistCompletion`, `OpChecklistItem`, `OpChecklistItemCompletion` |
| `web/src/components/ChecklistItemRow.tsx` | CREATE | Toggle row individual |
| `web/src/components/ChecklistCard.tsx` | CREATE | Card de completion do dia |
| `web/src/screens/Checklists.tsx` | CREATE | Tela principal + realtime subscription |
| `web/src/App.tsx` | MODIFY | Rota `/checklists` |
| `web/src/components/BottomNav.tsx` | MODIFY | Tab Checklists + ícone |

---

## Task 1: Database Migration

**Files:**
- Apply via Supabase MCP: `mcp__4c04bb52__apply_migration`

### Passo a passo

- [ ] **Step 1: Verificar colunas existentes nas 3 tabelas**

Execute via Supabase MCP (`execute_sql`):
```sql
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('op_checklists','op_checklist_completions','op_checklist_item_completions')
ORDER BY table_name, ordinal_position;
```
Anote quais colunas já existem antes de aplicar a migration.

- [ ] **Step 2: Aplicar migration via Supabase MCP**

Nome da migration: `add_op_checklists_operational_columns`

```sql
-- ============================================================
-- Migration: Checklists Operacionais
-- Adiciona colunas operacionais ausentes nas 3 tabelas
-- ============================================================

-- 1. op_checklists — frequência, horário, threshold
ALTER TABLE op_checklists
  ADD COLUMN IF NOT EXISTS completion_threshold int NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS dispatch_time TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS days_of_week int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5];
-- unit TEXT já existe com DEFAULT 'all' — não tocar

-- 2. op_checklist_completions — quando foi disparado (guard anti-double-send)
ALTER TABLE op_checklist_completions
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- Dedup guard: impede double-dispatch para o mesmo collab+template+dia
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'op_checklist_completions_collab_template_date_unique'
  ) THEN
    ALTER TABLE op_checklist_completions
      ADD CONSTRAINT op_checklist_completions_collab_template_date_unique
      UNIQUE (collaborator_id, template_id, completion_date);
  END IF;
END $$;

-- 3. op_checklist_item_completions — canal e janela de tempo
ALTER TABLE op_checklist_item_completions
  ADD COLUMN IF NOT EXISTS late boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('pwa', 'whatsapp'));

-- UPSERT guard: necessário para ON CONFLICT (completion_id, item_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'op_checklist_item_completions_completion_item_unique'
  ) THEN
    ALTER TABLE op_checklist_item_completions
      ADD CONSTRAINT op_checklist_item_completions_completion_item_unique
      UNIQUE (completion_id, item_id);
  END IF;
END $$;
```

- [ ] **Step 3: Verificar migration aplicada**

```sql
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('op_checklists','op_checklist_completions','op_checklist_item_completions')
  AND column_name IN (
    'completion_threshold','dispatch_time','days_of_week',
    'dispatched_at','late','channel'
  )
ORDER BY table_name, column_name;
```

**Esperado:** 6 linhas. Se alguma estiver faltando, a migration falhou — releia o erro do MCP.

- [ ] **Step 4: Verificar constraints únicas**

```sql
SELECT conname, conrelid::regclass AS table_name
FROM pg_constraint
WHERE conname IN (
  'op_checklist_completions_collab_template_date_unique',
  'op_checklist_item_completions_completion_item_unique'
);
```

**Esperado:** 2 linhas.

---

## Task 2: Seed Data

**Files:**
- Apply via Supabase MCP: `execute_sql`

- [ ] **Step 1: Inspecionar colunas de op_checklists para montar INSERT correto**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'op_checklists'
ORDER BY ordinal_position;
```

Use o resultado para confirmar quais colunas existem antes do INSERT.

- [ ] **Step 2: Inserir 4 templates**

```sql
INSERT INTO op_checklists
  (name, function_role, unit, shift, days_of_week, dispatch_time, completion_threshold)
VALUES
  ('Abertura Escola',    'secretary_morning',     'all', 'morning',   ARRAY[1,2,3,4,5],   '07:30'::time, 80),
  ('Fechamento Escola',  'secretary_evening',     'all', 'evening',   ARRAY[1,2,3,4,5],   '21:30'::time, 80),
  ('Fiscalização Salas', 'pedagogical_assistant', 'all', 'afternoon', ARRAY[1,2,3,4,5,6], '13:00'::time, 80),
  ('Limpeza',            'cleaning',              'all', 'full',      ARRAY[1,2,3,4,5,6], '07:00'::time, 100)
ON CONFLICT DO NOTHING
RETURNING id, name;
```

Copie os 4 UUIDs retornados — serão usados no Step 3.

- [ ] **Step 3: Inserir itens dos 4 templates**

Substitua `<ID_ABERTURA>`, `<ID_FECHAMENTO>`, `<ID_FISCALIZACAO>`, `<ID_LIMPEZA>` pelos UUIDs do Step 2.

```sql
-- Abertura Escola
INSERT INTO op_checklist_items (template_id, name, sort_order) VALUES
  ('<ID_ABERTURA>', 'Abrir portões e recepção', 1),
  ('<ID_ABERTURA>', 'Ligar sistemas de som das salas', 2),
  ('<ID_ABERTURA>', 'Conferir ar-condicionado das salas', 3),
  ('<ID_ABERTURA>', 'Verificar presença de professores do turno', 4),
  ('<ID_ABERTURA>', 'Checar agenda do dia no sistema', 5),
  ('<ID_ABERTURA>', 'Organizar recepção e material de boas-vindas', 6),
  ('<ID_ABERTURA>', 'Registrar horário de abertura', 7);

-- Fechamento Escola
INSERT INTO op_checklist_items (template_id, name, sort_order) VALUES
  ('<ID_FECHAMENTO>', 'Confirmar saída de todos os alunos', 1),
  ('<ID_FECHAMENTO>', 'Desligar sistemas de som', 2),
  ('<ID_FECHAMENTO>', 'Desligar ar-condicionados', 3),
  ('<ID_FECHAMENTO>', 'Fechar e trancar salas', 4),
  ('<ID_FECHAMENTO>', 'Verificar luzes e ventiladores', 5),
  ('<ID_FECHAMENTO>', 'Fechar portões e acionar alarme', 6),
  ('<ID_FECHAMENTO>', 'Registrar horário de fechamento', 7);

-- Fiscalização Salas
INSERT INTO op_checklist_items (template_id, name, sort_order) VALUES
  ('<ID_FISCALIZACAO>', 'Verificar limpeza das salas', 1),
  ('<ID_FISCALIZACAO>', 'Conferir equipamentos (teclados, amplificadores, cabos)', 2),
  ('<ID_FISCALIZACAO>', 'Checar quadros e material didático', 3),
  ('<ID_FISCALIZACAO>', 'Registrar sala com problema (se houver)', 4),
  ('<ID_FISCALIZACAO>', 'Confirmar salas prontas para o próximo turno', 5),
  ('<ID_FISCALIZACAO>', 'Comunicar manutenção pendente ao coordenador', 6);

-- Limpeza
INSERT INTO op_checklist_items (template_id, name, sort_order) VALUES
  ('<ID_LIMPEZA>', 'Limpar e varrer recepção', 1),
  ('<ID_LIMPEZA>', 'Limpar banheiros (masculino e feminino)', 2),
  ('<ID_LIMPEZA>', 'Limpar e organizar salas de aula', 3),
  ('<ID_LIMPEZA>', 'Recolher lixo de todas as áreas', 4),
  ('<ID_LIMPEZA>', 'Lavar área de copa/cozinha', 5),
  ('<ID_LIMPEZA>', 'Passar pano úmido nos corredores', 6),
  ('<ID_LIMPEZA>', 'Repor papel higiênico e sabonete', 7);
```

- [ ] **Step 4: Verificar seed**

```sql
SELECT t.name, COUNT(i.id) AS total_items, t.dispatch_time, t.completion_threshold
FROM op_checklists t
LEFT JOIN op_checklist_items i ON i.template_id = t.id
GROUP BY t.id, t.name, t.dispatch_time, t.completion_threshold
ORDER BY t.dispatch_time;
```

**Esperado:** 4 linhas. Limpeza=7, Abertura=7, Fiscalização=6, Fechamento=7.

---

## Task 3: Engine — Marker CHECKLIST_ACTION

**Files:**
- Modify: `src/engine.js`

> **Nota:** O closing tag do sistema é `<<END>>` (consistente com CHECKPOINT_BATCH, linha 288 do engine). O spec usou `<</CHECKLIST_ACTION>>` — corrija para `<<END>>` nos dois lugares (engine + skill).

- [ ] **Step 1: Adicionar `parseChecklistActionMarker` em engine.js**

Localize a função `parseCheckpointBatchMarker` (linha ~286). Adicione **logo após** ela:

```js
// Sprint 11 F2+ — Marker <<CHECKLIST_ACTION>>. TOM emite quando colaborador
// responde a checklist operacional enviado pelo cron. Persiste em
// op_checklist_item_completions com canal 'whatsapp'. Valida completion_id
// (uuid) e array items com { item_id, done }.
function parseChecklistActionMarker(text) {
  if (!text) return null;
  const re = /<<CHECKLIST_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('CHECKLIST_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!parsed.completion_id || !UUID_RE.test(parsed.completion_id)) {
    logSchemaErr('CHECKLIST_ACTION', ['completion_id:missing_or_invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    logSchemaErr('CHECKLIST_ACTION', ['items:empty_or_not_array'], parsed);
    return { malformed: true, cleanText };
  }
  const valid = [];
  const dropped = [];
  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i];
    if (!item.item_id || !UUID_RE.test(item.item_id)) {
      dropped.push(`item[${i}]:item_id_invalid`);
    } else if (typeof item.done !== 'boolean') {
      dropped.push(`item[${i}]:done_not_boolean`);
    } else {
      valid.push(item);
    }
  }
  if (dropped.length) logSchemaErr('CHECKLIST_ACTION', dropped, parsed);
  if (!valid.length) return { malformed: true, cleanText };

  return {
    completion_id: parsed.completion_id,
    items: valid,
    channel: typeof parsed.channel === 'string' ? parsed.channel : 'whatsapp',
    cleanText,
    malformed: false,
  };
}
```

- [ ] **Step 2: Adicionar `applyChecklistAction` em engine.js**

Adicione logo após `parseChecklistActionMarker`:

```js
async function applyChecklistAction(collaborator, parsed) {
  const { completion_id, items, channel } = parsed;

  // 1. Busca completion + template (threshold)
  const { data: completion, error: fetchErr } = await supabase
    .from('op_checklist_completions')
    .select('id, dispatched_at, completed_at, template_id, op_checklists(completion_threshold)')
    .eq('id', completion_id)
    .eq('collaborator_id', collaborator.id)
    .single();

  if (fetchErr || !completion) {
    console.warn(`[ChecklistAction] completion ${completion_id} not found for collab ${collaborator.id}`);
    return { ok: false, reason: 'completion_not_found' };
  }

  // 2. Janela 6h
  const now = new Date();
  const dispatchedAt = completion.dispatched_at ? new Date(completion.dispatched_at) : now;
  const windowEnd = new Date(dispatchedAt.getTime() + 6 * 60 * 60 * 1000);
  const isLate = now > windowEnd;

  // 3. UPSERT cada item
  for (const item of items) {
    const { error } = await supabase
      .from('op_checklist_item_completions')
      .upsert(
        {
          completion_id,
          item_id: item.item_id,
          done: item.done,
          channel: channel || 'whatsapp',
          late: isLate,
        },
        { onConflict: 'completion_id,item_id' }
      );
    if (error) console.warn(`[ChecklistAction] upsert item ${item.item_id}:`, error.message);
  }

  // 4. Recalcular progresso
  const { count: totalCount } = await supabase
    .from('op_checklist_items')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', completion.template_id);

  const { count: doneCount } = await supabase
    .from('op_checklist_item_completions')
    .select('id', { count: 'exact', head: true })
    .eq('completion_id', completion_id)
    .eq('done', true);

  const threshold = completion.op_checklists?.completion_threshold ?? 80;
  const pct = totalCount > 0 ? Math.round(((doneCount ?? 0) / totalCount) * 100) : 0;

  // 5. Marcar completed_at se threshold atingido (somente se ainda não estava completo)
  if (pct >= threshold && !completion.completed_at) {
    await supabase
      .from('op_checklist_completions')
      .update({ completed_at: now.toISOString() })
      .eq('id', completion_id);
  }

  return { ok: true, pct, doneCount: doneCount ?? 0, totalCount: totalCount ?? 0, isLate, threshold };
}
```

- [ ] **Step 3: Registrar o marker no pipeline do engine**

Procure no engine o bloco onde `parseCheckpointBatchMarker` é chamado (linha ~2192). Adicione um bloco **análogo** para CHECKLIST_ACTION, **logo antes** desse bloco (ou após — mas antes do `sendMessage` final):

```js
  // Sprint 11 F2+ — <<CHECKLIST_ACTION>> — resposta do colaborador a checklist diário.
  {
    const parsedCA = parseChecklistActionMarker(reply);
    if (parsedCA && parsedCA.malformed) {
      console.warn('[ChecklistAction] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'CHECKLIST_ACTION', 'rejected', 'schema_invalid', reply);
      reply = parsedCA.cleanText || reply;
    } else if (parsedCA) {
      const result = await applyChecklistAction(collab, parsedCA);
      await logMarker(
        collab.id,
        'CHECKLIST_ACTION',
        result.ok ? 'executed' : 'rejected',
        result.ok
          ? `pct=${result.pct} done=${result.doneCount}/${result.totalCount} late=${result.isLate}`
          : result.reason,
        null
      );
      // Substitui reply pelo cleanText (sem o bloco do marker)
      let base = parsedCA.cleanText || '';
      if (result.ok) {
        if (!base) {
          const lateNote = result.isLate ? ' _(fora do prazo — não conta no KPI)_' : '';
          base = result.pct >= result.threshold
            ? `✅ Checklist registrado — ${result.doneCount}/${result.totalCount} itens (${result.pct}%).${lateNote}`
            : `⚠️ ${result.doneCount}/${result.totalCount} itens (${result.pct}%) — abaixo do mínimo (${result.threshold}%). Registrado como parcial.${lateNote}`;
        }
      }
      reply = base || reply;
    }
  }
```

- [ ] **Step 4: Verificar que não quebrou nada com um smoke test**

No VPS:
```bash
node -e "
const e = require('./src/engine');
console.log('engine loaded ok, exports:', Object.keys(e).join(', '));
"
```
**Esperado:** sem erro de sintaxe, lista de exports impressa.

- [ ] **Step 5: Commit**

```bash
git add src/engine.js
git commit -m "feat(engine): add CHECKLIST_ACTION marker parser + applyChecklistAction"
```

---

## Task 4: System.js — Active Checklist Context + Valid Markers

**Files:**
- Modify: `src/prompts/system.js`

- [ ] **Step 1: Adicionar `getActiveChecklistHint` em system.js**

Localize a função `inferActiveThread` em system.js. Adicione **logo após** ela:

```js
/**
 * Retorna hint de checklist operacional ativo para injetar no system prompt.
 * Apenas se houver op_checklist_completions pendente hoje.
 */
async function getActiveChecklistHint(collaboratorId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('op_checklist_completions')
    .select(`
      id, dispatched_at,
      op_checklists (
        name, completion_threshold,
        op_checklist_items ( id, name, sort_order )
      )
    `)
    .eq('collaborator_id', collaboratorId)
    .eq('completion_date', today)
    .is('completed_at', null)
    .order('dispatched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return '';

  const template = data.op_checklists;
  if (!template) return '';

  const now = new Date();
  const dispatchedAt = data.dispatched_at ? new Date(data.dispatched_at) : now;
  const windowEnd = new Date(dispatchedAt.getTime() + 6 * 60 * 60 * 1000);
  if (now > windowEnd) return ''; // janela encerrada, não injeta

  const items = (template.op_checklist_items || [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item, i) => `${i + 1}. [item_id:${item.id}] ${item.name}`)
    .join('\n');

  return (
    `\n\n---\n` +
    `🗒️ **CHECKLIST OPERACIONAL ATIVO**\n` +
    `Template: ${template.name} (threshold: ${template.completion_threshold}%)\n` +
    `completion_id: ${data.id}\n` +
    `Itens:\n${items}\n\n` +
    `Se o colaborador está respondendo a este checklist, emita:\n` +
    `<<CHECKLIST_ACTION>>\n{"completion_id":"${data.id}","items":[{"item_id":"<uuid>","done":true}],"channel":"whatsapp"}\n<<END>>`
  );
}
```

- [ ] **Step 2: Chamar `getActiveChecklistHint` no `buildSystemPrompt`**

Dentro de `buildSystemPrompt` (ou onde o system prompt final é montado), adicione a chamada. Procure onde `renderActiveThreadHint` é injetado e adicione logo abaixo:

```js
  // Checklist operacional ativo (se houver dispatch pendente hoje)
  const checklistHint = await getActiveChecklistHint(collaborator.id);
  if (checklistHint) {
    systemPrompt += checklistHint;
  }
```

- [ ] **Step 3: Adicionar `<<CHECKLIST_ACTION>>` na lista de marcadores válidos**

Procure em system.js onde `<<CHECKPOINT_BATCH>>` está listado como marker válido (dentro do system prompt ou BLOCK_RULES). Adicione `<<CHECKLIST_ACTION>>` na mesma lista:

Exemplo — se houver uma string como:
```js
`Marcadores válidos: <<TASK_UPDATE>>, <<EVENT_CREATE>>, <<CHECKPOINT_BATCH>>.`
```
Altere para:
```js
`Marcadores válidos: <<TASK_UPDATE>>, <<EVENT_CREATE>>, <<CHECKPOINT_BATCH>>, <<CHECKLIST_ACTION>>.`
```

- [ ] **Step 4: Smoke test**

```bash
node -e "
const s = require('./src/prompts/system');
console.log('system loaded ok, exports:', Object.keys(s).join(', '));
"
```
**Esperado:** sem erro de sintaxe.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/system.js
git commit -m "feat(system): inject active checklist hint + register CHECKLIST_ACTION marker"
```

---

## Task 5: Dispatcher — dispatchChecklists

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Adicionar `dispatchChecklists` no dispatcher.js**

Localize o final das funções auxiliares (antes da função `run()`). Adicione:

```js
// Sprint 11 F2+ — Checklists Operacionais.
// Roda a cada tick do dispatcher (15 min). Detecta templates cujo dispatch_time
// caiu na janela [now-5min, now]. Cria op_checklist_completions e envia WhatsApp.
// dry=true: retorna lista de would_dispatch sem persistir nem enviar.
async function dispatchChecklists(now = new Date(), { dry = false, filterPhone = null } = {}) {
  // Normaliza para horário de Brasília
  const brStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  const brNow = new Date(brStr);
  const dow = brNow.getDay() === 0 ? 7 : brNow.getDay(); // 1=seg…6=sab,7=dom

  const pad = n => String(n).padStart(2, '0');
  const timeNow = `${pad(brNow.getHours())}:${pad(brNow.getMinutes())}`;
  const brMinus5 = new Date(brNow.getTime() - 5 * 60 * 1000);
  const timeMinus5 = `${pad(brMinus5.getHours())}:${pad(brMinus5.getMinutes())}`;
  const today = brNow.toISOString().slice(0, 10);

  // Templates cujo dispatch_time caiu na janela
  const { data: templates, error: tErr } = await supabase
    .from('op_checklists')
    .select('*, op_checklist_items(id, name, sort_order)')
    .contains('days_of_week', [dow])
    .gte('dispatch_time', timeMinus5)
    .lte('dispatch_time', timeNow);

  if (tErr) { console.error('[dispatchChecklists] query templates:', tErr.message); return []; }
  if (!templates || templates.length === 0) return [];

  const results = [];

  for (const template of templates) {
    // Colaboradores com function_role + shift correspondente
    let collabQuery = supabase
      .from('collaborators')
      .select('id, full_name, phone, unit, shift, function_role')
      .eq('function_role', template.function_role)
      .eq('shift', template.shift);
    if (filterPhone) collabQuery = collabQuery.eq('phone', filterPhone);

    const { data: collabs } = await collabQuery;
    if (!collabs || collabs.length === 0) {
      results.push({ template_id: template.id, reason: 'no_collaborators', would_dispatch: false });
      continue;
    }

    // Unidades que têm template específico (para aplicar prioridade unit > 'all')
    let specificUnits = [];
    if (template.unit === 'all') {
      const { data: specifics } = await supabase
        .from('op_checklists')
        .select('unit')
        .eq('function_role', template.function_role)
        .eq('shift', template.shift)
        .neq('unit', 'all')
        .contains('days_of_week', [dow])
        .gte('dispatch_time', timeMinus5)
        .lte('dispatch_time', timeNow);
      specificUnits = (specifics || []).map(s => s.unit);
    }

    for (const collab of collabs) {
      // Unit priority: pula collab que tem template específico disponível
      if (template.unit === 'all' && specificUnits.includes(collab.unit)) {
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'has_specific_template', would_dispatch: false });
        continue;
      }

      // Idempotência: já foi dispatched hoje?
      const { data: existing } = await supabase
        .from('op_checklist_completions')
        .select('id')
        .eq('collaborator_id', collab.id)
        .eq('template_id', template.id)
        .eq('completion_date', today)
        .maybeSingle();

      if (existing) {
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'already_dispatched', would_dispatch: false });
        continue;
      }

      if (dry) {
        results.push({ collab_id: collab.id, collab_name: collab.full_name, template_id: template.id, template_name: template.name, reason: 'ok', would_dispatch: true });
        continue;
      }

      // Criar completion record
      const { data: completion, error: insErr } = await supabase
        .from('op_checklist_completions')
        .insert({
          collaborator_id: collab.id,
          template_id: template.id,
          completion_date: today,
          dispatched_at: now.toISOString(),
        })
        .select('id')
        .single();

      if (insErr) {
        // ON CONFLICT: já existe (race condition) — skip silencioso
        console.warn(`[dispatchChecklists] insert completion collab=${collab.id} template=${template.id}:`, insErr.message);
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'insert_failed', would_dispatch: false });
        continue;
      }

      // Montar mensagem WhatsApp
      const sortedItems = (template.op_checklist_items || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item, i) => `${i + 1}. ${item.name}`)
        .join('\n');

      const msg =
        `📋 *Checklist: ${template.name}*\n` +
        `Marque os itens concluídos:\n${sortedItems}\n\n` +
        `Responda com os números (ex: *1 3 5*) ou *feito tudo*.`;

      try {
        await whatsapp.sendMessage(collab.phone, msg);
        await supabase.from('conversation_history').insert({
          collaborator_id: collab.id,
          direction: 'outbound',
          content: msg,
        });
        results.push({ collab_id: collab.id, collab_name: collab.full_name, template_id: template.id, template_name: template.name, completion_id: completion.id, reason: 'dispatched', would_dispatch: true });
      } catch (sendErr) {
        console.error(`[dispatchChecklists] sendMessage collab=${collab.id}:`, sendErr.message);
        results.push({ collab_id: collab.id, template_id: template.id, reason: 'send_failed', would_dispatch: false });
      }
    }
  }

  if (results.length) console.log('[dispatchChecklists]', JSON.stringify(results));
  return results;
}
```

- [ ] **Step 2: Verificar que `whatsapp` está importado no dispatcher**

Procure no topo do arquivo por `require('../services/whatsapp')`. Se não existir, adicione:

```js
const whatsapp = require('../services/whatsapp');
```

- [ ] **Step 3: Chamar `dispatchChecklists` na função `run()`**

Dentro da função `run()`, depois das outras chamadas de check (ex: após `checkReminders`), adicione:

```js
  // Sprint 11 F2+ — checklists operacionais diários
  await dispatchChecklists(now);
```

- [ ] **Step 4: Dry-run manual para validar**

```bash
node -e "
process.chdir('/opt/LA-Organizer');
require('./src/rituals/dispatcher');
" 2>&1 | head -5
# Apenas verifica que o módulo carrega sem erro de sintaxe.
```

Para dry-run real (sem enviar mensagem):
```bash
node -e "
process.chdir('/opt/LA-Organizer');
const path = require('path');
require('./src/rituals/dispatcher.js');
" --dry
# Ou importar a função diretamente se exportada
```

- [ ] **Step 5: Exportar `dispatchChecklists` para testes**

No final do arquivo, onde estão os `module.exports`, adicione `dispatchChecklists`:

```js
// Adicionar na linha de exports existente:
module.exports = { ..., dispatchChecklists };
```

- [ ] **Step 6: Commit**

```bash
git add src/rituals/dispatcher.js
git commit -m "feat(dispatcher): add dispatchChecklists with dry-run support"
```

---

## Task 6: Skill — checklist-tarefas.md

**Files:**
- Modify: `skills/checklist-tarefas.md`

- [ ] **Step 1: Ler o arquivo atual**

```bash
cat skills/checklist-tarefas.md
```

- [ ] **Step 2: Adicionar seção de Checklists Operacionais ao final da skill**

Adicione no final de `skills/checklist-tarefas.md`:

```markdown
---

## Checklists Operacionais Diários

Quando o system prompt contiver `🗒️ **CHECKLIST OPERACIONAL ATIVO**`, o colaborador está respondendo ao checklist do dia enviado pelo cron.

### Como interpretar a resposta

| Input do colaborador | O que marcar |
|---|---|
| "feito tudo" / "ok tudo" / "✅" / "tudo feito" | Todos os itens com `done: true` |
| "1 3 5" / "1, 3, 5" / "fiz o 1 2 e 4" | Somente os itens citados com `done: true`; demais `done: false` |
| "pulei o 2" / "não fiz o 3" / "todos menos o 4" | Todos com `done: true` exceto os citados (`done: false`) |
| Resposta ambígua | Pedir confirmação: "Entendi que você marcou [X]. Confirma? (s/n)" — NÃO emitir marker sem confirmação |

### Emissão do marker

Use os `item_id` exatos do system prompt. Nunca invente UUIDs.

```
<<CHECKLIST_ACTION>>
{
  "completion_id": "<completion_id do system prompt>",
  "items": [
    { "item_id": "<uuid>", "done": true },
    { "item_id": "<uuid>", "done": false }
  ],
  "channel": "whatsapp"
}
<<END>>
```

### Regras

- **Sempre liste todos os itens** no array `items` (mesmo os `done: false`), para que o engine possa calcular o progresso correto.
- **Closing tag é `<<END>>`**, não `<</CHECKLIST_ACTION>>`.
- **Não emita o marker** sem ter o `completion_id` — ele vem sempre no system prompt quando há checklist ativo.
- **Confirme ao colaborador** após emitir: o engine vai sobrescrever com a mensagem de resultado, mas se o engine não processar, a confirmação manual é fallback.
```

- [ ] **Step 3: Commit**

```bash
git add skills/checklist-tarefas.md
git commit -m "feat(skill): add operational checklist flow to checklist-tarefas"
```

---

## Task 7: PWA Types

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Ler o arquivo atual de types**

Abra `web/src/types.ts` e localize o final do arquivo.

- [ ] **Step 2: Adicionar tipos de Checklists Operacionais**

Adicione ao final de `web/src/types.ts`:

```typescript
// ── Checklists Operacionais ──────────────────────────────────────────────────

export interface OpChecklistTemplate {
  id: string
  name: string
  function_role: string
  unit: string
  shift: string
  days_of_week: number[]
  dispatch_time: string        // "HH:MM"
  completion_threshold: number  // 0–100
}

export interface OpChecklistItem {
  id: string
  template_id: string
  name: string
  sort_order: number
}

export interface OpChecklistItemCompletion {
  id: string
  completion_id: string
  item_id: string
  done: boolean
  channel: 'pwa' | 'whatsapp'
  late: boolean
}

export interface OpChecklistCompletion {
  id: string
  collaborator_id: string
  template_id: string
  completion_date: string      // "YYYY-MM-DD"
  dispatched_at: string | null
  completed_at: string | null
  // joins
  op_checklists: OpChecklistTemplate & {
    op_checklist_items: OpChecklistItem[]
  }
  op_checklist_item_completions: OpChecklistItemCompletion[]
}

/** Retorna true se o checklist está fora da janela de 6h */
export function isChecklistWindowClosed(dispatchedAt: string | null): boolean {
  if (!dispatchedAt) return false
  const end = new Date(new Date(dispatchedAt).getTime() + 6 * 60 * 60 * 1000)
  return new Date() > end
}
```

- [ ] **Step 3: Verificar que o TypeScript aceita os tipos**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

**Esperado:** 0 erros relacionados a `OpChecklist*` (outros erros pré-existentes são OK).

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts
git commit -m "feat(types): add OpChecklist* types for operational checklists"
```

---

## Task 8: PWA Components

**Files:**
- Create: `web/src/components/ChecklistItemRow.tsx`
- Create: `web/src/components/ChecklistCard.tsx`

- [ ] **Step 1: Criar `ChecklistItemRow.tsx`**

```tsx
// web/src/components/ChecklistItemRow.tsx
interface Props {
  index: number
  name: string
  done: boolean
  readonly: boolean
  onToggle: () => void
}

export function ChecklistItemRow({ index, name, done, readonly, onToggle }: Props) {
  return (
    <button
      type="button"
      className={[
        'w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors',
        readonly
          ? 'cursor-default opacity-70'
          : 'hover:bg-bg-surface cursor-pointer active:opacity-80',
      ].join(' ')}
      onClick={readonly ? undefined : onToggle}
      disabled={readonly}
    >
      <span
        className={[
          'w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors',
          done ? 'bg-success border-success' : 'border-border',
        ].join(' ')}
      >
        {done && (
          <svg className="text-white" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={['text-body-sm', done ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
        {index}. {name}
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Criar `ChecklistCard.tsx`**

```tsx
// web/src/components/ChecklistCard.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ChecklistItemRow } from './ChecklistItemRow'
import type { OpChecklistCompletion, OpChecklistItemCompletion } from '../types'
import { isChecklistWindowClosed } from '../types'

interface Props {
  completion: OpChecklistCompletion
}

export function ChecklistCard({ completion }: Props) {
  const queryClient = useQueryClient()
  const template = completion.op_checklists
  const items = [...(template.op_checklist_items ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order
  )
  const itemCompletions: OpChecklistItemCompletion[] =
    completion.op_checklist_item_completions ?? []

  const doneCount = itemCompletions.filter(ic => ic.done).length
  const totalCount = items.length
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0
  const windowClosed = isChecklistWindowClosed(completion.dispatched_at)
  const readonly = !!completion.completed_at || windowClosed

  const badge = completion.completed_at
    ? { label: '✅ Completo', cls: 'text-success' }
    : windowClosed
    ? { label: '⏰ Encerrado', cls: 'text-fg-muted' }
    : doneCount > 0
    ? { label: '🔄 Em andamento', cls: 'text-brand' }
    : { label: '⏳ Pendente', cls: 'text-fg-muted' }

  const toggleMutation = useMutation({
    mutationFn: async ({
      itemId,
      currentDone,
    }: {
      itemId: string
      currentDone: boolean
    }) => {
      const late = isChecklistWindowClosed(completion.dispatched_at)
      const { error } = await supabase.from('op_checklist_item_completions').upsert(
        {
          completion_id: completion.id,
          item_id: itemId,
          done: !currentDone,
          channel: 'pwa',
          late,
        },
        { onConflict: 'completion_id,item_id' }
      )
      if (error) throw error

      // Recalcula threshold localmente e atualiza completed_at se necessário
      const newDone = !currentDone ? doneCount + 1 : Math.max(doneCount - 1, 0)
      const newPct = totalCount > 0 ? Math.round((newDone / totalCount) * 100) : 0
      if (newPct >= template.completion_threshold && !completion.completed_at) {
        await supabase
          .from('op_checklist_completions')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', completion.id)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklists'] })
    },
  })

  return (
    <div className="bg-bg-surface rounded-xl shadow-sm border border-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-body font-semibold text-fg">{template.name}</h2>
        <span className={['text-body-sm font-medium', badge.cls].join(' ')}>
          {badge.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-bg-app rounded-full h-2 mb-1">
        <div
          className="bg-success h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-caption text-fg-muted mb-3">
        {doneCount}/{totalCount} itens ({pct}%)
      </p>

      {/* Items */}
      <div className="space-y-1">
        {items.map((item, index) => {
          const ic = itemCompletions.find(c => c.item_id === item.id)
          return (
            <ChecklistItemRow
              key={item.id}
              index={index + 1}
              name={item.name}
              done={ic?.done ?? false}
              readonly={readonly}
              onToggle={() =>
                toggleMutation.mutate({ itemId: item.id, currentDone: ic?.done ?? false })
              }
            />
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -E "ChecklistCard|ChecklistItemRow" | head -10
```

**Esperado:** 0 erros nesses dois arquivos.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChecklistItemRow.tsx web/src/components/ChecklistCard.tsx
git commit -m "feat(components): add ChecklistItemRow + ChecklistCard"
```

---

## Task 9: PWA Screen + Route + Navigation

**Files:**
- Create: `web/src/screens/Checklists.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/BottomNav.tsx`

- [ ] **Step 1: Verificar que `user.id` do AuthContext corresponde ao `collaborator_id` em `op_checklist_completions`**

```sql
-- Pegar um collaborator_id de op_checklist_completions (se houver dados)
SELECT collaborator_id FROM op_checklist_completions LIMIT 1;

-- Comparar com o auth.uid() do usuário logado no Supabase Auth
-- Se os valores tiverem formatos diferentes, verifique como Hoje.tsx
-- faz a query de tasks para o usuário atual e replique o mesmo padrão.
```

Se `collaborator_id` referencia `collaborators.id` (≠ `auth.users.id`), substituir
`user!.id` por uma query que resolve o `collaborator_id` a partir do `user.id`.

- [ ] **Step 2: Criar `Checklists.tsx`**

```tsx
// web/src/screens/Checklists.tsx
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { ChecklistCard } from '../components/ChecklistCard'
import type { OpChecklistCompletion } from '../types'

export function Checklists() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: completions = [], isLoading } = useQuery<OpChecklistCompletion[]>({
    queryKey: ['checklists', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('op_checklist_completions')
        .select(`
          *,
          op_checklists (
            *,
            op_checklist_items ( id, name, sort_order )
          ),
          op_checklist_item_completions (*)
        `)
        .eq('collaborator_id', user!.id)
        .eq('completion_date', today)
        .order('dispatched_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as OpChecklistCompletion[]
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 30_000, // fallback se realtime cair
  })

  // Realtime subscription — atualiza quando WhatsApp marca item
  useEffect(() => {
    if (!completions.length) return
    const ids = completions.map(c => c.id)

    const channel = supabase
      .channel('checklist-item-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'op_checklist_item_completions',
          filter: `completion_id=in.(${ids.join(',')})`,
        },
        () => queryClient.invalidateQueries({ queryKey: ['checklists'] })
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'op_checklist_completions',
          filter: `collaborator_id=eq.${user!.id}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ['checklists'] })
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [completions.length, user?.id])

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="bg-bg-surface rounded-xl h-32 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!completions.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-2 text-fg-muted p-4">
        <span className="text-3xl">✅</span>
        <p className="text-body font-medium">Nenhum checklist para hoje</p>
        <p className="text-body-sm text-center">Os checklists do dia aparecerão aqui quando forem enviados.</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-content mx-auto pb-24">
      <h1 className="text-heading-sm font-bold text-fg">Checklists de Hoje</h1>
      {completions.map(completion => (
        <ChecklistCard key={completion.id} completion={completion} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Adicionar rota em App.tsx**

Em `web/src/App.tsx`, adicione o import e a rota:

```tsx
// Adicionar import (junto com os outros screens):
import { Checklists } from './screens/Checklists';

// Adicionar rota dentro de <AppShell> (junto com habitos, hoje, etc.):
<Route path="checklists" element={<Checklists />} />
```

Resultado final do bloco de rotas deve ficar:
```tsx
<Route path="hoje" element={<Hoje />} />
<Route path="semana" element={<Semana />} />
<Route path="projetos" element={<Projetos />} />
<Route path="projetos/novo" element={<NovoProjeto />} />
<Route path="projetos/:id" element={<ProjetoDetalhe />} />
<Route path="mais" element={<Mais />} />
<Route path="configuracoes" element={<Configuracoes />} />
<Route path="historico" element={<Historico />} />
<Route path="habitos" element={<Habitos />} />
<Route path="checklists" element={<Checklists />} />
```

- [ ] **Step 4: Adicionar tab em BottomNav.tsx**

Em `web/src/components/BottomNav.tsx`:

1. Adicionar import do ícone (junto com os demais imports lucide):
```tsx
import { Circle, CalendarDays, Rocket, ClipboardCheck, Menu } from 'lucide-react';
```

2. Adicionar item no array `items` (antes de `Mais`):
```tsx
const items: NavItem[] = [
  { to: '/hoje',        label: 'Hoje',       Icon: Circle },
  { to: '/semana',      label: 'Semana',     Icon: CalendarDays },
  { to: '/projetos',    label: 'Projetos',   Icon: Rocket },
  { to: '/checklists',  label: 'Checklists', Icon: ClipboardCheck },
  { to: '/mais',        label: 'Mais',       Icon: Menu },
];
```

3. Alterar o grid para 5 colunas:
```tsx
// Linha ~29: mudar grid-cols-4 para grid-cols-5
<ul className="grid grid-cols-5 max-w-content mx-auto md:hidden">
```

- [ ] **Step 5: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -E "Checklists|BottomNav|App" | head -10
```

**Esperado:** 0 erros nesses arquivos.

- [ ] **Step 6: Build de verificação**

```bash
cd web && npm run build 2>&1 | tail -10
```

**Esperado:** `built in X.XXs` sem erros.

- [ ] **Step 7: Commit**

```bash
git add web/src/screens/Checklists.tsx web/src/App.tsx web/src/components/BottomNav.tsx
git commit -m "feat(pwa): add /checklists screen with realtime subscription + nav tab"
```

---

## Task 10: E2E Validation

Validar cada camada de ponta a ponta antes de considerar a feature done.

### 10.1 Validação de DB

- [ ] **Step 1: Confirmar que migration e seed estão corretos**

```sql
-- Colunas novas
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND column_name IN ('completion_threshold','dispatch_time','days_of_week','dispatched_at','late','channel')
ORDER BY table_name;
-- Esperado: 6 linhas

-- Templates + itens
SELECT t.name, t.dispatch_time, t.completion_threshold, COUNT(i.id) total_items
FROM op_checklists t LEFT JOIN op_checklist_items i ON i.template_id=t.id
GROUP BY t.id ORDER BY t.dispatch_time;
-- Esperado: 4 templates, totais 7/7/6/7

-- Unique constraints
SELECT conname FROM pg_constraint
WHERE conname IN (
  'op_checklist_completions_collab_template_date_unique',
  'op_checklist_item_completions_completion_item_unique'
);
-- Esperado: 2 linhas
```

- [ ] **Step 2: Testar dedup — inserir duas vezes o mesmo completion**

```sql
-- Substitua <COLLAB_ID> e <TEMPLATE_ID> por valores reais
INSERT INTO op_checklist_completions (collaborator_id, template_id, completion_date)
VALUES ('<COLLAB_ID>', '<TEMPLATE_ID>', CURRENT_DATE)
ON CONFLICT (collaborator_id, template_id, completion_date) DO NOTHING;

INSERT INTO op_checklist_completions (collaborator_id, template_id, completion_date)
VALUES ('<COLLAB_ID>', '<TEMPLATE_ID>', CURRENT_DATE)
ON CONFLICT (collaborator_id, template_id, completion_date) DO NOTHING;

SELECT COUNT(*) FROM op_checklist_completions
WHERE collaborator_id='<COLLAB_ID>' AND template_id='<TEMPLATE_ID>' AND completion_date=CURRENT_DATE;
-- Esperado: 1 (não duplicou)
```

- [ ] **Step 3: Testar threshold 80%**

```sql
-- Use completion real do Step 2. Insira 7 de 7 itens done=true e verifique completed_at.
-- (Teste manual — pode ser feito via PWA após Task 9.)
```

### 10.2 Validação WhatsApp → Engine

- [ ] **Step 4: Dry-run do dispatcher**

No VPS:
```bash
node -e "
process.chdir('/opt/LA-Organizer');
const { dispatchChecklists } = require('./src/rituals/dispatcher');
dispatchChecklists(new Date(), { dry: true }).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

**Esperado:** array JSON. Se `would_dispatch: true` → collab seria notificado. Se vazio ou só `reason: 'no_collaborators'` → verificar `function_role` e `shift` dos collabs no DB.

- [ ] **Step 5: Simular marker CHECKLIST_ACTION no engine**

```bash
node -e "
process.chdir('/opt/LA-Organizer');
const engine = require('./src/engine');

// Simular payload completo
const fakeReply = \`
Perfeito! Vou registrar.
<<CHECKLIST_ACTION>>
{
  \"completion_id\": \"00000000-0000-0000-0000-000000000001\",
  \"items\": [
    { \"item_id\": \"00000000-0000-0000-0000-000000000002\", \"done\": true }
  ],
  \"channel\": \"whatsapp\"
}
<<END>>
\`;

// O parser deve extrair o JSON e retornar cleanText
const { parseChecklistActionMarker } = engine;  // se exportado
// Se não exportado, testar via message flow completo no webhook
console.log('engine loaded ok');
"
```

Se `parseChecklistActionMarker` não foi exportado, adicione-o temporariamente aos exports para teste.

### 10.3 Validação PWA (Playwright)

- [ ] **Step 6: Criar completion de teste no DB para usar no Playwright**

```sql
-- Insira um completion de hoje com dispatched_at recente
INSERT INTO op_checklist_completions
  (collaborator_id, template_id, completion_date, dispatched_at)
SELECT
  '<COLLAB_ID>',
  id,
  CURRENT_DATE,
  NOW()
FROM op_checklists WHERE name = 'Abertura Escola'
ON CONFLICT DO NOTHING
RETURNING id;
```

Anote o `id` retornado.

- [ ] **Step 7: Playwright — tela carrega com card**

```bash
cd web && npx playwright test --headed -g "checklists" 2>&1 || echo "MANUAL: abrir /checklists no browser"
```

Se não houver suite Playwright configurada, faça manualmente:
1. Abrir `http://localhost:5173/checklists` (ou URL do preview)
2. Verificar que o card "Abertura Escola" aparece com os 7 itens

- [ ] **Step 8: Playwright — toggle de item**

Manualmente (ou via Playwright):
1. Clicar no item 1 → ✅ aparece, `done=true` no DB
2. Clicar novamente → desmarca, `done=false` no DB

Verificar no Supabase:
```sql
SELECT item_id, done, channel, late
FROM op_checklist_item_completions
WHERE completion_id = '<ID_DO_STEP_6>';
-- channel deve ser 'pwa'
```

- [ ] **Step 9: Playwright — threshold 80% → badge Completo**

1. Marcar 6 de 7 itens (≈ 86%, acima do threshold de 80%)
2. Badge deve mudar para "✅ Completo"
3. Verificar no DB:
```sql
SELECT completed_at FROM op_checklist_completions WHERE id='<ID>';
-- completed_at deve estar preenchido
```

- [ ] **Step 10: Verificar realtime**

1. Com o PWA aberto, executar no VPS:
```sql
INSERT INTO op_checklist_item_completions
  (completion_id, item_id, done, channel, late)
VALUES ('<COMPLETION_ID>', '<ITEM_ID>', true, 'whatsapp', false)
ON CONFLICT (completion_id, item_id) DO UPDATE SET done=true;
```
2. O PWA deve atualizar o item em ~1-2 segundos sem reload.

- [ ] **Step 11: Verificar janela encerrada**

Atualizar `dispatched_at` para 7h atrás:
```sql
UPDATE op_checklist_completions
SET dispatched_at = NOW() - INTERVAL '7 hours'
WHERE id = '<ID>';
```
Recarregar PWA → itens devem estar somente leitura, badge "⏰ Encerrado".

- [ ] **Step 12: Commit final + restart PM2**

```bash
git add -p  # review mudanças restantes
git commit -m "feat: Checklists Operacionais — MVP dual-channel completo"
pm2 restart LA-Organizer
pm2 logs LA-Organizer --lines 20
```

**Esperado:** sem erros de startup, `[dispatchChecklists]` aparece nos logs no próximo tick do cron.

---

## Checklist pós-implementação

- [ ] Migration aplicada e validada
- [ ] 4 templates + 27 itens no DB
- [ ] `dispatchChecklists` roda no cron sem erro
- [ ] Dry-run retorna `would_dispatch: true` para collabs corretos
- [ ] Marker `<<CHECKLIST_ACTION>>` parseia + aplica no DB
- [ ] `/checklists` carrega e renderiza cards
- [ ] Toggle de item via PWA persiste `channel='pwa'` no DB
- [ ] Realtime atualiza PWA quando WhatsApp marca item
- [ ] Badge muda para ✅ quando threshold atingido
- [ ] Janela encerrada → somente leitura no PWA
