# Sprint 4 — Recorrência (RRULE iCalendar) para Tasks e Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks e events podem repetir automaticamente via regra RRULE (iCalendar RFC 5545). Suporta diário/semanal/mensal/anual + casos complexos ("última sexta do mês", "a cada 15 dias", "todo dia útil").

**Architecture:** Adicionar coluna `recurrence_rule text` (RRULE string) e `recurrence_parent_id uuid` (FK self-reference) em `tasks` e `events`. Cada instância é row separada — preserva status individual (done/overdue) e permite editar 1 ocorrência sem afetar série. Job no dispatcher materializa próximas instâncias de cada série até 30 dias à frente, idempotente. TOM aprende a traduzir PT-BR pra RRULE via skill nova. PWA ganha checkbox + opções no form. Biblioteca `rrule` npm pra parse/iter.

**Tech Stack:** Node.js, biblioteca `rrule@2.x`, Supabase, React+Vite (PWA).

---

## ⚠️ Pré-requisitos

- Sprint 1 completo (data_classification — pra não materializar recorrência de teste)
- Dependência npm `rrule@^2.8.1` no backend e no PWA

---

## Mapa de arquivos

**Criar:**
- `supabase/migrations/20260528100000_recurrence_support.sql` — colunas + índices
- `src/services/recurrence-engine.js` — parse RRULE + materialização
- `src/rituals/recurrence-materializer.js` — job diário
- `skills/criar-recorrencia.md` — TOM aprende PT-BR → RRULE
- `web/src/components/RecurrencePicker.tsx` — UI no PWA (DS)
- `web/src/lib/recurrence-translate.ts` — RRULE → string humana ("toda segunda 14h")

**Modificar:**
- `package.json` (backend) — adicionar `rrule`
- `web/package.json` — adicionar `rrule`
- `src/engine.js` — `applyTaskActions`/`applyEventActions` aceitam `recurrence_rule` no payload
- `src/rituals/dispatcher.js` — chamar materializer no run() diário
- `web/src/components/QuickCreateSheet.tsx` — usar RecurrencePicker
- `web/src/components/EditEventSheet.tsx` — idem + "editar série vs ocorrência"

---

## Task 1: Migration

**Files:**
- Create: `supabase/migrations/20260528100000_recurrence_support.sql`

- [ ] **Step 1: SQL**

```sql
-- Sprint 29.4 — Recorrência via RRULE iCalendar (RFC 5545).
-- recurrence_rule: string RRULE (ex: "FREQ=WEEKLY;BYDAY=MO" — toda segunda)
-- recurrence_parent_id: aponta pra primeira instância da série (a "template")
-- Se ambos null → row não-recorrente (comportamento atual)
-- Se recurrence_rule não-null + parent null → row é a TEMPLATE (origem da série)
-- Se parent não-null → row é uma instância materializada

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recurrence_excluded boolean NOT NULL DEFAULT false;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS recurrence_parent_id uuid REFERENCES events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recurrence_excluded boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id) WHERE recurrence_parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_template ON tasks(id) WHERE recurrence_rule IS NOT NULL AND recurrence_parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_recurrence_parent ON events(recurrence_parent_id) WHERE recurrence_parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_recurrence_template ON events(id) WHERE recurrence_rule IS NOT NULL AND recurrence_parent_id IS NULL;

COMMENT ON COLUMN tasks.recurrence_rule IS 'Sprint 29.4 — RRULE iCalendar (RFC 5545). Ex: "FREQ=WEEKLY;BYDAY=MO". NULL em rows não-recorrentes ou instâncias materializadas.';
COMMENT ON COLUMN tasks.recurrence_parent_id IS 'Sprint 29.4 — aponta pra row template da série. NULL na própria template e em rows não-recorrentes.';
COMMENT ON COLUMN tasks.recurrence_excluded IS 'Sprint 29.4 — true = user excluiu essa ocorrência específica sem cancelar série.';
```

- [ ] **Step 2: Aplicar via MCP `apply_migration`**

- [ ] **Step 3: Validar com query**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('tasks','events') AND column_name LIKE 'recurrence%' ORDER BY 1;
```

Expected: 6 linhas (3 em tasks, 3 em events).

---

## Task 2: Dependência `rrule`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Instalar no backend**

```bash
cd /d/la-organizer/_remote && npm install rrule@2.8.1
```

- [ ] **Step 2: Instalar no frontend**

```bash
cd /d/la-organizer/_remote/web && npm install rrule@2.8.1
```

- [ ] **Step 3: Validar import**

```bash
node -e "const { RRule } = require('rrule'); console.log(new RRule({freq: RRule.WEEKLY, byweekday: [RRule.MO]}).toString())"
```

Expected: `FREQ=WEEKLY;BYDAY=MO`

---

## Task 3: Service `recurrence-engine.js`

**Files:**
- Create: `src/services/recurrence-engine.js`

- [ ] **Step 1: Implementar parse + materialização**

```javascript
// src/services/recurrence-engine.js — Sprint 29.4
//
// Por que existe: tasks/events com recurrence_rule precisam ter próximas
// ocorrências MATERIALIZADAS (rows reais no DB) pra entrar nas listas, briefings,
// notificações. Materialização preguiçosa: gera até 30 dias à frente, idempotente.
//
// Modelo: cada série tem 1 TEMPLATE (parent=null, rrule=set) + N instâncias
// (parent=template.id, rrule=null). User pode editar 1 instância sem afetar
// série (excluded=true não materializa novamente naquele timestamp).

const { RRule, rrulestr } = require('rrule');
const supabase = require('../supabase/client');

const MATERIALIZE_HORIZON_DAYS = 30;
const MAX_INSTANCES_PER_RUN = 50;

/**
 * Parse RRULE string com validação. Lança erro se inválida.
 */
function parseRule(rruleStr, dtstart) {
  if (!rruleStr) throw new Error('rrule_required');
  try {
    return rrulestr(`DTSTART:${_toIcalDate(dtstart)}\nRRULE:${rruleStr}`);
  } catch (e) {
    throw new Error(`invalid_rrule: ${e.message}`);
  }
}

function _toIcalDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Computa próximas N ocorrências entre [from, until].
 */
function nextOccurrences(rruleStr, dtstart, from, until, limit = 50) {
  const rule = parseRule(rruleStr, dtstart);
  return rule.between(from, until, true).slice(0, limit);
}

/**
 * Materializa instâncias futuras da série. Idempotente: skip se instância
 * pro mesmo timestamp já existe.
 * @param {'tasks'|'events'} table
 * @param {Object} template — row com recurrence_rule e id
 * @returns {Promise<{created: number, skipped: number}>}
 */
async function materializeSeries(table, template) {
  if (!template.recurrence_rule) return { created: 0, skipped: 0 };

  const dtstart = table === 'tasks'
    ? new Date(template.due_date + 'T12:00:00-03:00')
    : new Date(template.start_at);
  const now = new Date();
  const horizon = new Date(now.getTime() + MATERIALIZE_HORIZON_DAYS * 86400000);

  const occurrences = nextOccurrences(template.recurrence_rule, dtstart, now, horizon, MAX_INSTANCES_PER_RUN);
  if (occurrences.length === 0) return { created: 0, skipped: 0 };

  // Pega instâncias já materializadas pra dedupe
  const existingTimestamps = new Set();
  const tsCol = table === 'tasks' ? 'due_date' : 'start_at';
  const { data: existing } = await supabase
    .from(table)
    .select(tsCol)
    .eq('recurrence_parent_id', template.id);
  for (const row of existing || []) {
    const ts = row[tsCol];
    existingTimestamps.add(typeof ts === 'string' ? ts.slice(0, 10) : new Date(ts).toISOString().slice(0, 10));
  }

  const toInsert = [];
  for (const occ of occurrences) {
    const dateKey = occ.toISOString().slice(0, 10);
    if (existingTimestamps.has(dateKey)) continue;
    const row = _cloneTemplate(table, template, occ);
    toInsert.push(row);
  }

  if (toInsert.length === 0) return { created: 0, skipped: occurrences.length };

  const { error } = await supabase.from(table).insert(toInsert);
  if (error) {
    console.error(`[recurrence] insert err for series ${template.id}:`, error.message);
    return { created: 0, skipped: 0, error: error.message };
  }
  return { created: toInsert.length, skipped: occurrences.length - toInsert.length };
}

/**
 * Cria row de instância a partir do template, ajustando data e limpando
 * campos de identidade/status.
 */
function _cloneTemplate(table, template, occurrenceDate) {
  const base = { ...template };
  delete base.id;
  delete base.created_at;
  delete base.updated_at;
  delete base.completed_at;
  delete base.completed_by;
  // Instância NÃO carrega recurrence_rule — só template tem
  base.recurrence_rule = null;
  base.recurrence_parent_id = template.id;
  base.recurrence_excluded = false;
  base.status = 'pending';
  base.staleness_check_sent_at = null;
  base.coordination_request_count = 0;

  if (table === 'tasks') {
    base.due_date = occurrenceDate.toISOString().slice(0, 10);
    // remind_at: aplica mesmo HH:MM do template, na nova data
    if (template.remind_at) {
      const tmplTime = new Date(template.remind_at);
      const hh = tmplTime.getUTCHours();
      const mm = tmplTime.getUTCMinutes();
      const newRemind = new Date(occurrenceDate);
      newRemind.setUTCHours(hh, mm, 0, 0);
      base.remind_at = newRemind.toISOString();
    }
  } else {
    // events: start_at + end_at deslocados pra nova data, mantendo duração
    const tmplStart = new Date(template.start_at);
    const tmplEnd = template.end_at ? new Date(template.end_at) : null;
    const duration = tmplEnd ? tmplEnd.getTime() - tmplStart.getTime() : 3600000;
    const hh = tmplStart.getUTCHours();
    const mm = tmplStart.getUTCMinutes();
    const newStart = new Date(occurrenceDate);
    newStart.setUTCHours(hh, mm, 0, 0);
    base.start_at = newStart.toISOString();
    base.end_at = new Date(newStart.getTime() + duration).toISOString();
  }
  return base;
}

/**
 * Roda materialização pra TODAS as séries ativas. Chamado pelo dispatcher 1x/dia.
 */
async function materializeAll() {
  let totals = { tasks_created: 0, events_created: 0, series_processed: 0 };
  for (const table of ['tasks', 'events']) {
    const { data: templates } = await supabase
      .from(table)
      .select('*')
      .not('recurrence_rule', 'is', null)
      .is('recurrence_parent_id', null)
      .eq('data_classification', 'real')
      .limit(500);
    for (const tpl of templates || []) {
      try {
        const r = await materializeSeries(table, tpl);
        if (table === 'tasks') totals.tasks_created += r.created;
        else totals.events_created += r.created;
        totals.series_processed++;
      } catch (e) {
        console.error(`[recurrence] series ${tpl.id} err:`, e.message);
      }
    }
  }
  console.log(`[recurrence] materializeAll: ${JSON.stringify(totals)}`);
  return totals;
}

module.exports = { parseRule, nextOccurrences, materializeSeries, materializeAll };
```

- [ ] **Step 2: Syntax check + commit**

---

## Task 4: Ritual materializer no dispatcher

**Files:**
- Create: `src/rituals/recurrence-materializer.js`
- Modify: `src/rituals/dispatcher.js` (chamar no run())

- [ ] **Step 1: Wrapper do ritual**

```javascript
// src/rituals/recurrence-materializer.js
const { materializeAll } = require('../services/recurrence-engine');
const { nowSaoPaulo, currentSlot, timeToSlot } = require('./helpers');  // reusa helpers do dispatcher

async function tick() {
  const sp = nowSaoPaulo();
  // Roda 00:30 BRT, slot único
  if (currentSlot(sp) !== timeToSlot('00:30')) return;
  await materializeAll();
}

module.exports = { tick };
```

(Adaptar imports conforme estrutura existente.)

- [ ] **Step 2: Hookar no run() do dispatcher**

Logo após `autoArchiveStale` (Sprint 1 Task 10):

```javascript
try {
  const recurrence = require('./recurrence-materializer');
  await recurrence.tick();
} catch (err) {
  console.error('[recurrence] tick err:', err.message);
}
```

- [ ] **Step 3: Syntax check + deploy**

---

## Task 5: Engine aceita `recurrence_rule` em TASK/EVENT actions

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Validação do schema TASK_UPDATE**

Localizar `validateTaskAction` (vimos antes que rejeita campos desconhecidos). Adicionar `recurrence_rule` como campo aceito no action create.

```javascript
// Dentro de validateTaskAction, após validação dos campos atuais:
if (a.recurrence_rule !== undefined) {
  if (typeof a.recurrence_rule !== 'string' || !a.recurrence_rule.startsWith('FREQ=')) {
    errors.push(`action[${idx}]:bad_recurrence_rule`);
  } else {
    // Tenta parse pra rejeitar rrule inválida
    try {
      const { parseRule } = require('./services/recurrence-engine');
      const dtstart = a.due_date ? new Date(a.due_date + 'T12:00:00-03:00') : new Date();
      parseRule(a.recurrence_rule, dtstart);
    } catch (e) {
      errors.push(`action[${idx}]:invalid_rrule:${e.message.slice(0, 80)}`);
    }
  }
}
```

- [ ] **Step 2: Persistência em applyTaskActions**

No bloco `action === 'create'`, incluir `recurrence_rule` no insertRow:

```javascript
const insertRow = {
  // ... campos atuais ...
  recurrence_rule: a.recurrence_rule || null,
};
```

- [ ] **Step 3: Materialização imediata após criar template**

Logo após o insert bem-sucedido de TASK com `recurrence_rule`:

```javascript
if (a.recurrence_rule && inserted) {
  try {
    const { materializeSeries } = require('./services/recurrence-engine');
    await materializeSeries('tasks', inserted);
  } catch (e) {
    console.warn('[recurrence] initial materialize failed:', e.message);
  }
}
```

- [ ] **Step 4: Mesma lógica em applyEventActions** para events.

- [ ] **Step 5: Syntax check + deploy + commit**

---

## Task 6: Skill `criar-recorrencia.md`

**Files:**
- Create: `skills/criar-recorrencia.md`

- [ ] **Step 1: Documentar tradução PT-BR → RRULE**

```markdown
# Skill — Criar Recorrência

Você é TOM. Esta skill ativa quando user pede ação que se repete no tempo.

## Quando ativar

Gatilhos: "toda segunda", "todo dia", "todo mês", "todo dia X", "a cada N semanas/dias", "última sexta", "primeira segunda", "dia útil", "fim de semana", "semanal", "mensal", "diário", "quinzenal".

## Como agir

Inclua o campo `recurrence_rule` no marker TASK_UPDATE create (ou EVENT_CREATE) com a string RRULE correspondente.

## Tradução de padrões comuns

| User diz | RRULE |
|---|---|
| "todo dia" / "diário" | `FREQ=DAILY` |
| "toda semana" / "semanal" | `FREQ=WEEKLY` |
| "todo mês" / "mensal" | `FREQ=MONTHLY` |
| "todo ano" / "anual" | `FREQ=YEARLY` |
| "toda segunda" | `FREQ=WEEKLY;BYDAY=MO` |
| "toda segunda e quarta" | `FREQ=WEEKLY;BYDAY=MO,WE` |
| "todo dia útil" / "dias úteis" | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| "fim de semana" | `FREQ=WEEKLY;BYDAY=SA,SU` |
| "a cada 2 semanas" / "quinzenal" | `FREQ=WEEKLY;INTERVAL=2` |
| "todo dia 5 do mês" | `FREQ=MONTHLY;BYMONTHDAY=5` |
| "primeira segunda do mês" | `FREQ=MONTHLY;BYDAY=1MO` |
| "última sexta do mês" | `FREQ=MONTHLY;BYDAY=-1FR` |
| "1º e 15 do mês" | `FREQ=MONTHLY;BYMONTHDAY=1,15` |
| "todo natal" | `FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25` |

Códigos dias: MO TU WE TH FR SA SU. Mês: BYMONTH=1..12.

## Exemplos canônicos

**User:** "Tom, lembra de pagar conta de luz todo dia 5"

**TOM:**
```
✓ Lembrete mensal criado pra todo dia 5.
<<TASK_UPDATE>>
[{"action":"create","title":"Pagar conta de luz","due_date":"2026-06-05","remind_at":"2026-06-05T10:00:00-03:00","recurrence_rule":"FREQ=MONTHLY;BYMONTHDAY=5","context":"personal"}]
<<END>>
```

---

**User:** "Marca reunião com a equipe pedagógica toda segunda 14h"

**TOM:**
```
✓ Reunião semanal marcada — toda segunda 14h.
<<EVENT_CREATE>>
[{"title":"Reunião equipe pedagógica","start_at":"2026-06-01T14:00:00-03:00","end_at":"2026-06-01T15:00:00-03:00","category":"pedagogico","recurrence_rule":"FREQ=WEEKLY;BYDAY=MO"}]
<<END>>
```

## NÃO fazer

- ❌ Inventar campos não-RRULE (ex: `"weekly":true`) — usa só RRULE válida.
- ❌ Esquecer `BYDAY` quando user diz dia específico ("toda segunda" sem BYDAY vira repetição do dia da week_start).
- ❌ Materializar manualmente várias rows — emite só a TEMPLATE, engine materializa.
- ❌ Recorrência sem `due_date`/`start_at` — sempre dá data inicial (próxima ocorrência ou hoje).

## Editar série vs ocorrência

Se user disser "muda essa única" → action="reschedule" na instância específica (id da row, não da série).
Se user disser "muda a recorrência" / "muda toda semana" → action="reschedule" no TEMPLATE (parent=null), e engine remateriliza.
```

- [ ] **Step 2: Carregar dinamicamente em system.js**

Adicionar em `pickSkill` antes da seção de governança:

```javascript
const RECURRENCE_RE = /todo\s+(?:dia|m[eê]s|ano)|toda\s+(?:segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado|domingo|semana)|a\s+cada\s+\d+\s+(?:dia|semana|m[eê]s)|mensal|semanal|di[áa]rio|quinzenal|recorrente|repete|repetir/i;
if (RECURRENCE_RE.test(String(lastUserMessage || ''))) {
  return { name: 'criar-recorrencia', body: loadSkill('criar-recorrencia') };
}
```

- [ ] **Step 3: Commit**

---

## Task 7: PWA — RecurrencePicker component

**Files:**
- Create: `web/src/components/RecurrencePicker.tsx`

- [ ] **Step 1: Componente DS-friendly**

```tsx
// web/src/components/RecurrencePicker.tsx — Sprint 29.4
import { useState } from 'react';
import { CustomSelect } from './CustomSelect';
import { Field } from './Field';

type Preset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'monthly_day_of_week' | 'custom';

interface Props {
  value: string | null;            // RRULE string ou null
  onChange: (rrule: string | null) => void;
  startDate: string;               // YYYY-MM-DD (pra calcular default day_of_week)
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'none',                  label: 'Não repetir' },
  { value: 'daily',                 label: 'Todo dia' },
  { value: 'weekdays',              label: 'Dias úteis (seg-sex)' },
  { value: 'weekly',                label: 'Toda semana' },
  { value: 'biweekly',              label: 'A cada 2 semanas' },
  { value: 'monthly',               label: 'Todo mês (dia X)' },
  { value: 'monthly_day_of_week',   label: 'Toda 1ª segunda do mês' },
  { value: 'custom',                label: 'Personalizado (RRULE)' },
];

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function presetToRrule(preset: Preset, startDate: string): string | null {
  const d = new Date(startDate + 'T12:00:00Z');
  const dayCode = DAY_CODES[d.getUTCDay()];
  const dayOfMonth = d.getUTCDate();
  switch (preset) {
    case 'none':                return null;
    case 'daily':               return 'FREQ=DAILY';
    case 'weekdays':            return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly':              return `FREQ=WEEKLY;BYDAY=${dayCode}`;
    case 'biweekly':            return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`;
    case 'monthly':             return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`;
    case 'monthly_day_of_week': {
      const week = Math.ceil(dayOfMonth / 7);
      return `FREQ=MONTHLY;BYDAY=${week}${dayCode}`;
    }
    default:                    return null;
  }
}

function rruleToPreset(rrule: string | null): Preset {
  if (!rrule) return 'none';
  if (rrule === 'FREQ=DAILY') return 'daily';
  if (rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(rrule)) return 'weekly';
  if (/^FREQ=WEEKLY;INTERVAL=2;BYDAY=[A-Z]{2}$/.test(rrule)) return 'biweekly';
  if (/^FREQ=MONTHLY;BYMONTHDAY=\d+$/.test(rrule)) return 'monthly';
  if (/^FREQ=MONTHLY;BYDAY=-?\d?[A-Z]{2}$/.test(rrule)) return 'monthly_day_of_week';
  return 'custom';
}

export function RecurrencePicker({ value, onChange, startDate }: Props) {
  const [preset, setPreset] = useState<Preset>(rruleToPreset(value));
  const [customRrule, setCustomRrule] = useState(value ?? '');

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === 'custom') {
      onChange(customRrule || null);
      return;
    }
    onChange(presetToRrule(p, startDate));
  }

  return (
    <Field label="Repetição">
      <CustomSelect
        value={preset}
        options={PRESETS}
        onChange={(v) => applyPreset(v as Preset)}
        size="md"
      />
      {preset === 'custom' && (
        <input
          className="mt-sm w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
          placeholder="ex: FREQ=MONTHLY;BYDAY=-1FR"
          value={customRrule}
          onChange={(e) => { setCustomRrule(e.target.value); onChange(e.target.value || null); }}
        />
      )}
    </Field>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /d/la-organizer/_remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

---

## Task 8: PWA — integrar RecurrencePicker em QuickCreateSheet e EditEventSheet

**Files:**
- Modify: `web/src/components/QuickCreateSheet.tsx`
- Modify: `web/src/components/EditEventSheet.tsx`

- [ ] **Step 1: QuickCreateSheet — adicionar RecurrencePicker no form**

Localizar o form de criação. Adicionar antes do botão "Criar":

```tsx
import { RecurrencePicker } from './RecurrencePicker';
// ...
const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
// ...
<RecurrencePicker
  value={recurrenceRule}
  onChange={setRecurrenceRule}
  startDate={dueDate}
/>
```

E incluir `recurrence_rule: recurrenceRule` no payload de insert.

- [ ] **Step 2: EditEventSheet — perguntar "editar série vs ocorrência"**

Quando editando row com `recurrence_parent_id` não-null, antes de salvar, modal:

```tsx
<BottomSheet>
  <p>Editar:</p>
  <Button onClick={() => editOnly(this)}>Só essa ocorrência</Button>
  <Button onClick={() => editSeries()}>Toda a série</Button>
</BottomSheet>
```

- "Só essa": update na instância (parent permanece intacto).
- "Toda a série": update no template (parent), engine remateriliza futuras.

- [ ] **Step 3: TypeScript check + build + commit**

---

## Task 9: Listas (Agenda) filtram instâncias materializadas

**Files:**
- Modify: `web/src/lib/events.ts`, `web/src/lib/tasks.ts` (ou onde queries são feitas)

- [ ] **Step 1: Garantir que listas mostrem APENAS instâncias materializadas (não templates)**

Templates têm `recurrence_rule` set + `recurrence_parent_id` null. Instâncias têm `recurrence_parent_id` set. Rows não-recorrentes têm ambos null.

```typescript
// Filtro: mostra rows não-recorrentes OU instâncias materializadas; ESCONDE templates.
.or('recurrence_rule.is.null,recurrence_parent_id.not.is.null')
```

- [ ] **Step 2: Validar visualmente no PWA — templates não aparecem; instâncias sim**

- [ ] **Step 3: Commit**

---

## Task 10: Validação end-to-end

- [ ] **Step 1: Via WhatsApp pro TOM**

> "Tom, lembra de pagar conta de luz todo dia 5"

Verificar:
1. Marker emitido com `recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=5"`
2. DB: 1 row template (recurrence_rule set, parent=null) + 1 row instância (parent=template.id, due_date=2026-06-05)

- [ ] **Step 2: Forçar materializer**

```bash
ssh tom 'cd /opt/LA-Organizer && set -a; . ./.env; set +a; node -e "
const r = require(\"./src/services/recurrence-engine\");
r.materializeAll().then(t => { console.log(JSON.stringify(t)); process.exit(0); });
"'
```

Expected: materializeAll cria mais instâncias até 30d à frente.

- [ ] **Step 3: Conferir DB**

```sql
SELECT id, title, due_date, recurrence_rule, recurrence_parent_id
FROM tasks
WHERE title ILIKE '%conta de luz%'
ORDER BY due_date;
```

Expected: 1 template + N instâncias mensais.

- [ ] **Step 4: Validar PWA**

Abrir agenda. Listas devem mostrar:
- ✅ instância de 05/06 (materializada)
- ❌ NÃO mostrar o template (poluiria a lista)

- [ ] **Step 5: Editar série**

Via PWA, abrir uma instância → "editar série" → mudar horário.
Verificar que template atualizou + instâncias futuras adotaram novo horário.

---

## Critério de pronto

- Criar task/event com recorrência via WhatsApp (TOM) e via PWA (RecurrencePicker).
- Job 00:30 BRT materializa próximas 30 dias automaticamente.
- Listas mostram só instâncias (templates escondidos).
- Editar "só essa" vs "toda a série" funciona.
- RRULE inválido rejeitado com mensagem clara no validate.

## Casos de uso cobertos no MVP

| Caso real do Alf | RRULE |
|---|---|
| Conta de luz todo dia 5 | `FREQ=MONTHLY;BYMONTHDAY=5` |
| Reunião pedagógica toda segunda 14h | `FREQ=WEEKLY;BYDAY=MO` |
| Briefing diário | `FREQ=DAILY` |
| Relatório quinzenal | `FREQ=WEEKLY;INTERVAL=2` |
| Última sexta do mês | `FREQ=MONTHLY;BYDAY=-1FR` |
| Dias úteis | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
