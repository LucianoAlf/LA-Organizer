# Sprint 21 — Autogovernança Guiada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar camada de autogovernança do TOM (rituais mensais cron, lista mental com pipeline sagrado, helper de progresso, captura retroativa contextual, limite suave anti-relay) sem refatorar o que já funciona.

**Architecture:** 1 migration cumulativa (CREATE `monthly_plans` + ALTER `tasks.source` CHECK + 2 colunas em `user_preferences`). 5 helpers novos em `src/engine.js` + 1 marker function. 2 blocos cron novos em `src/rituals/dispatcher.js` + helpers de calendário + `listLeadership`. Injeção de `[RELAY_LIMIT_HINT]` em `src/prompts/system.js`. 3 skills novas + 3 blocos novos em `skills/rituais-diarios.md`. Zero alteração no PWA.

**Tech Stack:** Node.js (CommonJS), Supabase JS client, Postgres (via Supabase MCP `apply_migration`), prompts em `.md`.

**Spec base:** `docs/superpowers/specs/2026-05-05-sprint21-autogovernanca-design.md` (commit `05d23e6` em `origin/main`).

**Convenção de verificação (este projeto não tem framework de testes):**
- `node --check <arquivo>` para syntax-check
- `grep` para verificar presença de strings/exports
- Supabase MCP `execute_sql` para smoke tests de schema/dados
- Bundle deploy só na última task (commit → push → VPS git pull → `pm2 restart tom`)

**IMPORTANTE — workflow de git neste repo:**
- `D:\la-organizer\_remote` **NÃO é um git working tree** (não tem `.git`). É uma cópia de trabalho local. Não rodar `git init` nem tentar commitar localmente nas Tasks 2–12.
- **Tasks 2–12: editar arquivos in-place em `_remote`. NÃO commitar.** Validar com `node --check`, `grep`, smoke tests inline e parar.
- **Task 13 faz o bundle único** via padrão clone temporário (já documentado nas Sprints 15/18/19): clona `https://github.com/LucianoAlf/LA-Organizer.git` em `/tmp/`, copia arquivos modificados de `_remote`, commita, pusha, apaga o clone.
- Steps "Commit" listados nas tasks 2–12 abaixo ficam **NO-OP / pular**. Mantidos no texto só para referência de mensagem de commit que entra no bundle final.

---

## File Structure

| Arquivo | Operação | Responsabilidade |
|---|---|---|
| `migrations/2026-05-05-sprint21.sql` | Create | DDL cumulativa (CREATE + ALTERs) |
| `src/engine.js` | Modify | +5 helpers + 1 marker function + export list |
| `src/rituals/dispatcher.js` | Modify | +2 blocos cron + 2 helpers calendário + `listLeadership` + wiring em `run()` |
| `src/prompts/system.js` | Modify | +injeção de `[RELAY_LIMIT_HINT]` no system prompt |
| `skills/lista-mental.md` | Create | Pipeline sagrado capturar→agrupar→propor→confirmar→persistir |
| `skills/planejamento-mensal.md` | Create | Ritual 1ª segunda do mês — metas + carry-over |
| `skills/fechamento-mensal.md` | Create | Ritual última sexta do mês — wins + retro + carry |
| `skills/rituais-diarios.md` | Modify | +Bloco A (proativo lista mental) +Bloco B (retroativo contextual) +Bloco C (barrinhas) |

---

### Task 1: Migration cumulativa (schema)

**Files:**
- Create: `migrations/2026-05-05-sprint21.sql`

- [ ] **Step 1: Escrever DDL completa**

```sql
-- 1. Nova tabela monthly_plans
CREATE TABLE monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  goals text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','skipped')),
  tasks_planned integer NOT NULL DEFAULT 0,
  tasks_completed integer NOT NULL DEFAULT 0,
  completion_rate numeric NOT NULL DEFAULT 0,
  retrospective_notes text,
  wins text[] NOT NULL DEFAULT '{}',
  carry_over_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collaborator_id, month_start)
);
ALTER TABLE monthly_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON monthly_plans FOR ALL USING (true);
CREATE POLICY "auth_read_own" ON monthly_plans FOR SELECT TO authenticated
  USING (collaborator_id = current_collab_id() OR current_collab_role() IN ('coordinator','director'));
CREATE POLICY "auth_write_own" ON monthly_plans FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());

-- 2. tasks.source CHECK estendido
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual','agent_briefing','agent_closing',
                    'checkpoint_decomposition','coordinator_assignment',
                    'system','mental_dump','retroactive_capture'));

-- 3. user_preferences — horários dos rituais mensais
ALTER TABLE user_preferences
  ADD COLUMN monthly_planning_time time NOT NULL DEFAULT '07:00',
  ADD COLUMN monthly_closing_time  time NOT NULL DEFAULT '18:00';
```

- [ ] **Step 2: Aplicar migration via Supabase MCP**

Tool: `mcp__4c04bb52-...__apply_migration` com `name="sprint21_autogovernanca"` e o SQL acima.
Expected: success, sem erro de constraint pré-existente.

- [ ] **Step 3: Smoke test schema**

Via `execute_sql`:
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='monthly_plans';
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='tasks_source_check';
SELECT column_name FROM information_schema.columns
  WHERE table_name='user_preferences' AND column_name LIKE 'monthly_%';
```
Expected: 14 colunas em `monthly_plans`, CHECK inclui `mental_dump` e `retroactive_capture`, 2 colunas novas em `user_preferences`.

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-05-05-sprint21.sql
git commit -m "feat(sprint21): migration monthly_plans + tasks.source + user_preferences mensais"
```

---

### Task 2: Helper `computeProgress` em engine.js

**Files:**
- Modify: `src/engine.js` (adicionar antes da seção de exports, ~linha 5240)

- [ ] **Step 1: Implementar `computeProgress`**

```js
async function computeProgress(scope, collabId, refDateOrProjectId, opts = {}) {
  const context = opts.context || 'all';
  let start, end, isProject = false;
  if (scope === 'project') {
    isProject = true;
  } else {
    const ref = new Date(refDateOrProjectId + 'T12:00:00');
    if (scope === 'day') {
      start = end = refDateOrProjectId;
    } else if (scope === 'week') {
      const dow = ref.getDay();
      const monOffset = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(ref); mon.setDate(ref.getDate() + monOffset);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      start = mon.toISOString().slice(0,10);
      end   = sun.toISOString().slice(0,10);
    } else if (scope === 'month') {
      const y = ref.getFullYear(), m = ref.getMonth();
      start = new Date(y, m, 1).toISOString().slice(0,10);
      end   = new Date(y, m+1, 0).toISOString().slice(0,10);
    } else {
      throw new Error(`computeProgress: scope inválido ${scope}`);
    }
  }
  let q = supabase.from('tasks').select('status, context', { count: 'exact' })
    .eq('assigned_to', collabId).neq('status','cancelled');
  if (isProject) {
    q = q.eq('project_id', refDateOrProjectId);
  } else {
    q = q.gte('due_date', start).lte('due_date', end);
  }
  if (context !== 'all') q = q.eq('context', context);
  const { data, count } = await q;
  const total = count || 0;
  if (total === 0) {
    return { pct: null, done: 0, total: 0, scope, period: isProject ? null : { start, end }, empty: true };
  }
  const done = (data || []).filter(t => t.status === 'done').length;
  return { pct: Math.round((done/total)*100), done, total, scope,
           period: isProject ? null : { start, end }, empty: false };
}
```

- [ ] **Step 2: Adicionar ao module.exports**

Localizar `module.exports = { ... }` (~linha 5252) e adicionar `computeProgress`.

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check src/engine.js
```
Expected: sem erro.

- [ ] **Step 4: Smoke test inline**

```bash
node -e "const e=require('./src/engine.js'); console.log(typeof e.computeProgress);"
```
Expected: `function`.

- [ ] **Step 5: Commit**

```bash
git add src/engine.js
git commit -m "feat(sprint21): computeProgress helper (day/week/month/project)"
```

---

### Task 3: Helper `getRitualIntroDecision`

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Implementar conforme spec §5.3**

```js
async function getRitualIntroDecision(collabId, ritualType) {
  const { data } = await supabase
    .from('ritual_logs')
    .select('status, created_at')
    .eq('collaborator_id', collabId)
    .eq('ritual_type', ritualType)
    .order('created_at', { ascending: false })
    .limit(5);
  if (!data || data.length === 0) return 'show_intro';
  const wasInstructed = data.some(r => r.status === 'sent');
  if (wasInstructed) return 'send_ritual';
  const recent = data.slice(0, 3);
  if (recent.length === 3 && recent.every(r => ['intro_shown','skipped'].includes(r.status))) {
    return 'skip_saturated';
  }
  return 'show_intro';
}
```

- [ ] **Step 2: Adicionar ao module.exports**

Adicionar `getRitualIntroDecision`.

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check src/engine.js && node -e "console.log(typeof require('./src/engine.js').getRitualIntroDecision)"
```
Expected: `function`.

- [ ] **Step 4: Smoke test**

Via Supabase MCP `execute_sql`:
```sql
INSERT INTO ritual_logs (collaborator_id, ritual_type, status, created_at)
VALUES ('<id_alf>', 'monthly_planning_test', 'sent', now());
```
Em seguida `node -e "require('./src/engine.js').getRitualIntroDecision('<id_alf>','monthly_planning_test').then(console.log)"`.
Expected: `send_ritual`. Limpar com `DELETE FROM ritual_logs WHERE ritual_type='monthly_planning_test'`.

- [ ] **Step 5: Commit**

```bash
git add src/engine.js
git commit -m "feat(sprint21): getRitualIntroDecision (3 estados de aceite)"
```

---

### Task 4: Anti-relay — counter + hint builder

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Implementar `countRecentRelaysToRecipient`**

```js
async function countRecentRelaysToRecipient(requesterId, recipientId, refDate) {
  const start = new Date(refDate); start.setHours(0,0,0,0);
  const end   = new Date(refDate); end.setHours(23,59,59,999);
  const { count } = await supabase
    .from('coordination_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requester_id', requesterId)
    .eq('recipient_id', recipientId)
    .in('status', ['sent','responded'])
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  return count || 0;
}
```

- [ ] **Step 2: Implementar `buildRelayLimitHint`**

```js
async function buildRelayLimitHint(requesterId) {
  const start = new Date(); start.setHours(0,0,0,0);
  const end   = new Date(); end.setHours(23,59,59,999);
  const { data } = await supabase
    .from('coordination_requests')
    .select('recipient_id, recipient:collaborators!coordination_requests_recipient_id_fkey(full_name)')
    .eq('requester_id', requesterId)
    .in('status', ['sent','responded'])
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());
  if (!data?.length) return null;
  const counts = new Map();
  const names  = new Map();
  for (const row of data) {
    counts.set(row.recipient_id, (counts.get(row.recipient_id) || 0) + 1);
    if (row.recipient?.full_name) names.set(row.recipient_id, row.recipient.full_name.split(' ')[0]);
  }
  const heavy = [...counts.entries()]
    .filter(([_, n]) => n >= 5)
    .map(([id, n]) => `- ${names.get(id) || 'destinatário'}: ${n} relays hoje`);
  if (!heavy.length) return null;
  return `[RELAY_LIMIT_HINT]\nCanal saturado com:\n${heavy.join('\n')}\n\nAntes de emitir novo relay para esses destinatários específicos, sugira ao usuário falar direto. Não bloqueie — avise: "Você já usou o TOM N vezes com [nome] hoje. Posso mandar esse, mas talvez valha falar direto com ele/ela depois dessa." Para destinatários não listados acima, opere normalmente.`;
}
```

- [ ] **Step 3: Adicionar ambos ao module.exports**

- [ ] **Step 4: Verificar sintaxe + smoke**

```bash
node --check src/engine.js
node -e "require('./src/engine.js').buildRelayLimitHint('<id_alf>').then(r=>console.log(r===null?'null OK':r))"
```
Expected: `null OK` (sem 5+ relays hoje).

- [ ] **Step 5: Commit**

```bash
git add src/engine.js
git commit -m "feat(sprint21): limite suave anti-relay (counter + hint builder)"
```

---

### Task 5: Marker `<<MONTHLY_PLAN>>` (parser + applier)

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Localizar `parseWeeklyPlanMarker` e `applyWeeklyPlan` como referência**

```bash
grep -n "parseWeeklyPlanMarker\|applyWeeklyPlan" src/engine.js
```

- [ ] **Step 2: Implementar `parseMonthlyPlanMarker`**

```js
function parseMonthlyPlanMarker(text) {
  const match = text.match(/<<MONTHLY_PLAN>>([\s\S]*?)<<END>>/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[1].trim());
    if (!obj.month_start) return null;
    return {
      month_start: obj.month_start,
      goals: Array.isArray(obj.goals) ? obj.goals : [],
      carry_over_notes: obj.carry_over_notes || null,
      wins: Array.isArray(obj.wins) ? obj.wins : [],
      retrospective_notes: obj.retrospective_notes || null,
      action: obj.action || 'plan'  // 'plan' (abertura) | 'close' (fechamento)
    };
  } catch (e) { return null; }
}
```

- [ ] **Step 3: Implementar `applyMonthlyPlan`**

```js
async function applyMonthlyPlan(collab, plan) {
  const { data: existing } = await supabase
    .from('monthly_plans')
    .select('id')
    .eq('collaborator_id', collab.id)
    .eq('month_start', plan.month_start)
    .maybeSingle();
  const payload = {
    collaborator_id: collab.id,
    month_start: plan.month_start,
    goals: plan.goals,
    carry_over_notes: plan.carry_over_notes,
    updated_at: new Date().toISOString()
  };
  if (plan.action === 'close') {
    payload.status = 'completed';
    payload.wins = plan.wins;
    payload.retrospective_notes = plan.retrospective_notes;
  }
  if (existing) {
    await supabase.from('monthly_plans').update(payload).eq('id', existing.id);
    return { id: existing.id, action: 'updated' };
  }
  const { data: created } = await supabase
    .from('monthly_plans').insert(payload).select('id').single();
  return { id: created?.id, action: 'created' };
}
```

- [ ] **Step 4: Localizar pipeline de markers em `processMessage` e plugar**

```bash
grep -n "parseWeeklyPlanMarker\|applyWeeklyPlan(" src/engine.js
```
Adicionar chamada análoga a `parseMonthlyPlanMarker` + `applyMonthlyPlan` no mesmo loop.

- [ ] **Step 5: Adicionar ao module.exports + verificar sintaxe**

```bash
node --check src/engine.js
```

- [ ] **Step 6: Commit**

```bash
git add src/engine.js
git commit -m "feat(sprint21): marker MONTHLY_PLAN (parse + apply, plug em processMessage)"
```

---

### Task 6: Injeção de `[RELAY_LIMIT_HINT]` no system prompt

**Files:**
- Modify: `src/engine.js` (chamada em `processMessage`)
- Modify: `src/prompts/system.js` (se hint vier de fora) **ou** apenas append em runtime

- [ ] **Step 1: Localizar onde COORD_HINT/ACC são injetados**

```bash
grep -n "COORD_HINT\|FOCUS_CANDIDATE\|systemPrompt\s*\+=" src/engine.js src/prompts/system.js
```

- [ ] **Step 2: Adicionar a chamada após COORD_HINT/ACC, antes de mandar pra LLM**

Em `src/engine.js processMessage`:

```js
const relayHint = await buildRelayLimitHint(collab.id);
if (relayHint) systemPrompt += '\n\n' + relayHint;
```

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check src/engine.js
```

- [ ] **Step 4: Smoke test (presença do bloco)**

```bash
grep -n "RELAY_LIMIT_HINT\|buildRelayLimitHint" src/engine.js
```
Expected: ≥3 ocorrências (declaração + export + chamada).

- [ ] **Step 5: Commit**

```bash
git add src/engine.js src/prompts/system.js
git commit -m "feat(sprint21): injeção de RELAY_LIMIT_HINT no system prompt"
```

---

### Task 7: Calendário + `listLeadership` no dispatcher

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Adicionar helpers de calendário**

```js
function isFirstMondayOfMonth(date) {
  if (date.getDay() !== 1) return false;
  return date.getDate() <= 7;
}
function isLastFridayOfMonth(date) {
  if (date.getDay() !== 5) return false;
  const next = new Date(date); next.setDate(date.getDate() + 7);
  return next.getMonth() !== date.getMonth();
}
```

- [ ] **Step 2: Adicionar `listLeadership`**

```js
async function listLeadership() {
  // Alinha com o pattern existente em listCoordinators (linha ~226):
  // select wide + filter por user_preferences populado para evitar
  // regressão em rituais que dependem disso.
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, unit, is_active, onboarding_completed, user_preferences(*)')
    .in('role', ['director', 'coordinator', 'manager'])
    .eq('is_active', true);
  return (data || []).filter(c => c.user_preferences);
}
```

- [ ] **Step 3: Verificar sintaxe + smoke**

```bash
node --check src/rituals/dispatcher.js
```

- [ ] **Step 4: Smoke `listLeadership` retorna 8**

```bash
node -e "require('./src/rituals/dispatcher.js').listLeadership().then(r=>console.log(r.length, r.map(c=>c.full_name)))"
```
Expected: ~8 nomes (Alf, Anne, Juliana, Quintela, Jereh, Clayton, Krissya, Yuri). Se `listLeadership` não estiver exportado, exportar e re-rodar.

- [ ] **Step 5: Commit**

```bash
git add src/rituals/dispatcher.js
git commit -m "feat(sprint21): calendário (1ª segunda / última sexta) + listLeadership"
```

---

### Task 8: Blocos cron mensais + wiring em `run()`

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Implementar `checkMonthlyPlanning`**

```js
async function checkMonthlyPlanning(now) {
  if (!isFirstMondayOfMonth(now)) return;
  const collabs = await listLeadership();
  const ymdToday = nowSaoPaulo().ymd;
  for (const c of collabs) {
    const time = c.user_preferences?.monthly_planning_time || '07:00';
    if (currentSlot(now) !== timeToSlot(time)) continue;
    if (await alreadySent(c.id, 'monthly_planning', ymdToday)) continue;
    const decision = await getRitualIntroDecision(c.id, 'monthly_planning');
    try {
      if (decision === 'show_intro') {
        await sendRitual(c.id, 'monthly_planning_intro');
        await logRitualEvent(c.id, 'monthly_planning', 'intro_shown', null, ymdToday);
      } else if (decision === 'send_ritual') {
        await sendRitual(c.id, 'monthly_planning');
        await logRitualEvent(c.id, 'monthly_planning', 'sent', null, ymdToday);
      } else {
        await logRitualEvent(c.id, 'monthly_planning', 'skipped', 'saturated', ymdToday);
      }
    } catch (e) { console.error('[checkMonthlyPlanning]', c.full_name, e.message); }
  }
}
```

- [ ] **Step 2: Implementar `checkMonthlyClosing` (espelho com `isLastFridayOfMonth` e `monthly_closing`)**

Mesma estrutura, trocando o helper de calendário, o `ritual_type` (`monthly_closing`), o `monthly_planning_time` por `monthly_closing_time`, e os nomes de ritual (`monthly_closing_intro` / `monthly_closing`).

- [ ] **Step 3: Wiring em `run()`**

Localizar a sequência atual (~`checkChecklistConsequences` antes de `notifyCoordinators`):

```bash
grep -n "checkChecklistConsequences\|notifyCoordinators" src/rituals/dispatcher.js
```

Adicionar (try/catch por bloco — não-fatal):

```js
try { await checkMonthlyPlanning(now); } catch (e) { console.error('[run] monthlyPlanning', e); }
try { await checkMonthlyClosing(now);  } catch (e) { console.error('[run] monthlyClosing', e); }
```

- [ ] **Step 4: Verificar sintaxe**

```bash
node --check src/rituals/dispatcher.js
```

- [ ] **Step 5: Smoke (sem disparar)**

Forçar `now = nova segunda fora de janela`:
```bash
node -e "const d=require('./src/rituals/dispatcher.js'); d.checkMonthlyPlanning(new Date('2026-05-06T10:00:00-03:00')).then(()=>console.log('OK no-op'))"
```
Expected: `OK no-op` (não é 1ª segunda).

- [ ] **Step 6: Commit**

```bash
git add src/rituals/dispatcher.js
git commit -m "feat(sprint21): rituais mensais — checkMonthlyPlanning + checkMonthlyClosing wired"
```

---

### Task 9: Skill `lista-mental.md`

**Files:**
- Create: `skills/lista-mental.md`

- [ ] **Step 1: Escrever skill (~6KB) com seções**

Estrutura obrigatória (conforme spec §6):
- **Quando ativa** (primary triggers + auxiliar contextual)
- **Pra que serve** (seção α curta — usada em preâmbulo e quando user pergunta)
- **Pipeline sagrado** (capturar → agrupar → propor → confirmar → persistir, com classes: `task`, `event`, `project`, `memory`, `resolve_now`)
- **Regra `resolve_now`** (não persiste auto; reclassifica pra `task` ou `remind_at` se não resolvível inline)
- **Microconfirmação condicional** (item único claro → marker direto; lote/ambíguo → pipeline)
- **Contextual por papel** (coord, gerente, director, manager+all)
- **Tag de origem** (`source='mental_dump'` em tasks; prefixo `(via mental dump YYYY-MM-DD)` em memory; `Origem: mental dump YYYY-MM-DD` em events/projects)
- **Markers reutilizados** — listar exemplos de `<<TASK_UPDATE>>`, `<<EVENT_CREATE>>`, `<<MEMORY_SAVE>>`, `<<PROJECT_CREATE>>`

- [ ] **Step 2: Verificar tamanho**

```bash
wc -c skills/lista-mental.md
```
Expected: ~5000-7000 bytes.

- [ ] **Step 3: Verificar gatilhos presentes**

```bash
grep -i "lista mental\|cabeça\|descarrega\|anota tudo" skills/lista-mental.md
```
Expected: ≥4 ocorrências.

- [ ] **Step 4: Registrar a skill no catálogo (se houver registry)**

```bash
grep -n "skills/" src/ai/*.js src/prompts/*.js | head -20
```
Se houver lista hardcoded de skills, adicionar `lista-mental` lá.

- [ ] **Step 5: Commit**

```bash
git add skills/lista-mental.md src/
git commit -m "feat(sprint21): skill lista-mental (pipeline sagrado + 5 categorias)"
```

---

### Task 10: Skill `planejamento-mensal.md`

**Files:**
- Create: `skills/planejamento-mensal.md`

- [ ] **Step 1: Escrever skill (~6KB)**

Conforme spec §7.1:
- **Quando ativa** (gatilho cron 1ª segunda + gatilhos verbais "planejamento mensal", "objetivos do mês")
- **Pra que serve** (seção α)
- **Fluxo** (a) revisão mês anterior via `computeProgress('month', collab, lastMonth)`; (b) escolha de 3-5 metas; (c) `carry_over_notes`
- **Marker emitido** — `<<MONTHLY_PLAN>>` com `action='plan'`
- **Não-objetivos** — não cria tasks individuais; não substitui planejamento semanal
- **Exemplo verbatim** de marker JSON

- [ ] **Step 2: Registrar skill + verificar**

```bash
wc -c skills/planejamento-mensal.md
grep -n "MONTHLY_PLAN" skills/planejamento-mensal.md
```
Expected: marker presente.

- [ ] **Step 3: Commit**

```bash
git add skills/planejamento-mensal.md src/
git commit -m "feat(sprint21): skill planejamento-mensal (1ª segunda do mês)"
```

---

### Task 11: Skill `fechamento-mensal.md`

**Files:**
- Create: `skills/fechamento-mensal.md`

- [ ] **Step 1: Escrever skill (~5KB)**

Conforme spec §7.2:
- **Quando ativa** (cron última sexta + gatilhos verbais)
- **Pra que serve** (seção α)
- **Fluxo** (a) `computeProgress('month', collab, today)` + barrinha; (b) `wins` (3-5); (c) `retrospective_notes`; (d) `carry_over_notes`; (e) `monthly_plans.status='completed'`
- **Marker** — `<<MONTHLY_PLAN>>` com `action='close'`
- **Apresentação** — barra contextual + delta vs mês anterior se disponível

- [ ] **Step 2: Verificar**

```bash
wc -c skills/fechamento-mensal.md
grep -n "action.*close\|MONTHLY_PLAN" skills/fechamento-mensal.md
```

- [ ] **Step 3: Commit**

```bash
git add skills/fechamento-mensal.md src/
git commit -m "feat(sprint21): skill fechamento-mensal (última sexta do mês)"
```

---

### Task 12: Extensões em `rituais-diarios.md` (Blocos A, B, C)

**Files:**
- Modify: `skills/rituais-diarios.md`

- [ ] **Step 1: Ler arquivo atual e identificar pontos de inserção**

```bash
grep -n "^##\|^###" skills/rituais-diarios.md
```

- [ ] **Step 2: Inserir Bloco A (~10 linhas) — captura proativa lista mental no briefing**

Pergunta uma vez por dia: *"Tem algo na cabeça que ainda não anotamos?"*. Se user disser não, cala. Variação por papel (coord/gerente/director/manager+all conforme spec §8.1 e §6.5).

- [ ] **Step 3: Inserir Bloco B (~25 linhas) — captura retroativa contextual no fechamento**

Sinais (any-of) que disparam:
- Conversa do dia menciona ações executadas fora da agenda
- Volume de chat não refletido em tasks
- Aderência baixa COM conversa ativa

Critério verbal (verbatim conforme spec §8.2). Microconfirmação condicional (item único → marker direto; lote/ambíguo → pipeline).

- [ ] **Step 4: Inserir Bloco C (~15 linhas) — barrinhas contextuais**

- Fechamento diário → `% do dia` (ou mensagem natural se `empty=true`, NUNCA "0%")
- Planejamento semanal e Fechamento semanal → `% da semana`
- Fechamento mensal → `% do mês` + delta vs mês anterior
- Projeto → só sob pergunta explícita
- Hábitos NUNCA aparecem (têm streak próprio)

- [ ] **Step 5: Verificar**

```bash
grep -n "Tem algo na cabeça\|retroactive_capture\|computeProgress\|empty.*true\|0%" skills/rituais-diarios.md
```
Expected: gatilhos dos 3 blocos presentes.

- [ ] **Step 6: Commit**

```bash
git add skills/rituais-diarios.md
git commit -m "feat(sprint21): rituais-diarios — blocos A (proativo) + B (retroativo) + C (barrinhas)"
```

---

### Task 13: Bundle deploy (clone temp + copy + commit + push + VPS pull + pm2)

**Files:**
- Nenhum novo. Bundle via clone temporário (padrão Sprints 15/18/19).

- [ ] **Step 1: Clone temporário**

```bash
TMPDIR=/tmp/sprint21-deploy-$(date +%s)
git clone https://github.com/LucianoAlf/LA-Organizer.git "$TMPDIR"
cd "$TMPDIR"
```

- [ ] **Step 2: Copiar arquivos modificados de `_remote`**

Lista de paths a copiar (criados ou modificados nas Tasks 1–12):
- `migrations/2026-05-05-sprint21.sql`
- `src/engine.js`
- `src/rituals/dispatcher.js`
- `src/prompts/system.js`
- `skills/lista-mental.md`
- `skills/planejamento-mensal.md`
- `skills/fechamento-mensal.md`
- `skills/rituais-diarios.md`

```bash
cp /d/la-organizer/_remote/migrations/2026-05-05-sprint21.sql "$TMPDIR/migrations/"
cp /d/la-organizer/_remote/src/engine.js "$TMPDIR/src/"
cp /d/la-organizer/_remote/src/rituals/dispatcher.js "$TMPDIR/src/rituals/"
cp /d/la-organizer/_remote/src/prompts/system.js "$TMPDIR/src/prompts/"
cp /d/la-organizer/_remote/skills/lista-mental.md "$TMPDIR/skills/"
cp /d/la-organizer/_remote/skills/planejamento-mensal.md "$TMPDIR/skills/"
cp /d/la-organizer/_remote/skills/fechamento-mensal.md "$TMPDIR/skills/"
cp /d/la-organizer/_remote/skills/rituais-diarios.md "$TMPDIR/skills/"
```

- [ ] **Step 3: Commit bundle**

```bash
cd "$TMPDIR"
git add -A
git status   # confirmar arquivos esperados
git commit -m "feat(sprint21): autogovernança guiada — rituais mensais + lista mental + relay limit + barrinhas contextuais"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: VPS pull + restart (via ssh)**

Comando manual ou via skill de deploy existente. Padrão Sprint 19/20: `ssh vps 'cd /opt/tom && git pull && pm2 restart tom'`. Confirmar com user antes de executar.

- [ ] **Step 4: Smoke pós-deploy**

Via Supabase MCP `execute_sql`:
```sql
SELECT count(*) FROM monthly_plans;  -- 0 esperado
SELECT count(*) FROM ritual_logs WHERE ritual_type IN ('monthly_planning','monthly_closing');  -- 0 esperado
```

- [ ] **Step 6: Cleanup do clone temporário**

```bash
rm -rf "$TMPDIR"
```

- [ ] **Step 7: Forçar simulação (próxima 1ª segunda real ou manual)**

Manual no dispatcher (apenas em ambiente local/staging):
```bash
node -e "const d=require('./src/rituals/dispatcher.js'); d.checkMonthlyPlanning(new Date('2026-06-01T07:00:00-03:00')).then(()=>console.log('dispatch OK'))"
```
Expected (em prod com flag pra simular): preâmbulos disparados pra 8 colaboradores. Se não houver flag, pular este step e aguardar 1ª segunda real (2026-06-01).

- [ ] **Step 6: Atualizar memória + roadmap (closure)**

Closure report fica para a próxima sessão com user. Por ora apenas marcar Sprint 21 entregue:

```bash
# (manual via Edit no roadmap.md depois do "shake" de produção)
```

---

## Self-Review

**1. Spec coverage:** todas as 16 seções da spec mapeadas:
- §3 (schema) → Task 1
- §4 (computeProgress) → Task 2
- §5.3 (getRitualIntroDecision) → Task 3
- §5.1 + 5.2 (markers) → Task 5
- §5.4 + §11 (RELAY_LIMIT_HINT) → Tasks 4 + 6
- §6 (lista-mental) → Task 9
- §7.1 (planejamento mensal) → Task 10
- §7.2 (fechamento mensal) → Task 11
- §8 (rituais-diarios extensões) → Task 12
- §9 (dispatcher) → Tasks 7 + 8
- §10 (TOM-instrutor transversal) → distribuído entre Tasks 3, 9, 10, 11
- §12-§16 (decisões/critérios/riscos) → respeitados em cada task
- Deploy bundle → Task 13

**2. Placeholders:** zero "TBD". Todos os helpers têm corpo verbatim. Skills têm seções listadas com conteúdo a ser escrito guiado pelo spec. Comandos exatos.

**3. Type consistency:** `getRitualIntroDecision` retorna `'show_intro' | 'send_ritual' | 'skip_saturated'` — nomes idênticos em Tasks 3 e 8. `computeProgress` retorna `{ pct, done, total, scope, period, empty }` consistente em Tasks 2, 10, 11, 12. Marker `<<MONTHLY_PLAN>>` com `action: 'plan'|'close'` consistente entre Tasks 5, 10, 11.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-sprint21-autogovernanca.md`. Two execution options:

**1. Subagent-Driven (recomendado — mesmo padrão Sprint 19/20)** — dispatch fresh subagent por task, two-stage review (spec + quality) entre tasks, iteração rápida sem poluir contexto desta sessão.

**2. Inline Execution** — executa tasks nesta sessão via `superpowers:executing-plans` com checkpoints batch.

Qual abordagem?
