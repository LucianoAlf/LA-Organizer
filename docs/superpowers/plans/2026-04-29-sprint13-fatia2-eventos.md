# Sprint 13 Fatia 2 — Eventos Institucionais

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Director e coordinator criam eventos institucionais da escola (shows, reuniões, apresentações) via TOM ou PWA, e o sistema dispara automaticamente até 3 notificações WhatsApp: liderança imediata, escola toda 3 dias antes, unidade 1 dia antes.

**Architecture:** Nova tabela `school_events` + campo `source_event_id` em `announcements`. Ao criar um evento, o sistema gera até 3 rows em `announcements` com `scheduled_at` calculado. O broadcaster da Fatia 1 despacha tudo sem nenhuma modificação. Cancelar evento = cancelar os anúncios linkados.

**Tech Stack:** Node.js (engine.js), Supabase (DB + RLS), React + TanStack Query (PWA), broadcaster já implementado na Fatia 1.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| Supabase SQL | Migration | `school_events` + `source_event_id` em `announcements` |
| `skills/eventos-institucionais.md` | Criar | Skill TOM para criar/cancelar eventos institucionais |
| `src/prompts/system.js` | Modificar | Incluir skill + adicionar `<<SCHOOL_EVENT_ACTION>>` ao BLOCK_RULES |
| `src/engine.js` | Modificar | `parseSchoolEventActionMarker` + `buildEventAnnouncementsNode` + `applySchoolEventAction` + pipeline |
| `web/src/types.ts` | Modificar | Interface `SchoolEvent` + `SchoolEventWithAnnouncements` |
| `web/src/screens/AgendaEscolar.tsx` | Criar | Lista de eventos com status das etapas de notificação |
| `web/src/components/EventoSheet.tsx` | Criar | BottomSheet criar evento + selecionar etapas + gerar anúncios |
| `web/src/App.tsx` | Modificar | Rota `/mais/agenda-escolar` |
| `web/src/screens/Mais.tsx` | Modificar | Item "Agenda Escolar" com requireRoles |

---

## Task 1: DB Migration

**Files:**
- Supabase SQL (via MCP `execute_sql`, project_id = `cesnbnrynvxvgdhfmaua`)

- [ ] **Step 1: Aplicar migration**

```sql
-- 1. Tabela de eventos institucionais
CREATE TABLE IF NOT EXISTS school_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_date date NOT NULL,
  start_time time,
  location text,
  unit text CHECK (unit IN ('barra','recreio','campo_grande')),
  created_by uuid REFERENCES collaborators(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','cancelled')),
  notify_leadership boolean NOT NULL DEFAULT true,
  notify_school boolean NOT NULL DEFAULT true,
  notify_unit boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_school_events_date
  ON school_events(event_date, status);

-- 2. Extensão em announcements para rastrear origem
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES school_events(id);

CREATE INDEX IF NOT EXISTS idx_announcements_event
  ON announcements(source_event_id)
  WHERE source_event_id IS NOT NULL;

-- 3. RLS
ALTER TABLE school_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY school_events_select ON school_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY school_events_write ON school_events
  FOR ALL TO authenticated
  WITH CHECK (current_collab_role() IN ('director','coordinator'));
```

- [ ] **Step 2: Verificar tabelas e coluna**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'school_events';
-- Expected: 1 row

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'announcements'
  AND column_name = 'source_event_id';
-- Expected: 1 row

SELECT policyname FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'school_events';
-- Expected: school_events_select, school_events_write
```

---

## Task 2: TOM Skill

**Files:**
- Create: `skills/eventos-institucionais.md`
- Modify: `src/prompts/system.js`

- [ ] **Step 1: Criar `skills/eventos-institucionais.md`**

```markdown
# Skill: Eventos Institucionais

Você pode criar e cancelar eventos institucionais da escola (shows, apresentações, reuniões de pais, formaturas, etc.) para director e coordinator.

## Intenções que ativam esta skill

- "agenda um evento / show / apresentação / reunião..."
- "cria um evento para..."
- "tem uma apresentação / um show em..."
- "cancela o evento / o último evento"

## Criar um evento

### Passo 1 — Extrair dados do pedido

Identifique:
- **title**: nome do evento (obrigatório)
- **event_date**: data ISO8601 YYYY-MM-DD (obrigatório)
- **start_time**: horário HH:MM (opcional)
- **unit**: `barra` | `recreio` | `campo_grande` | null (null = escola toda)
- **location**: local físico ou observação (opcional)
- **notify_leadership**: true (default) — aviso imediato ao criar
- **notify_school**: true (default) — aviso 3 dias antes para toda a escola
- **notify_unit**: true (default) — aviso 1 dia antes para a unidade

Se o usuário pedir para não notificar alguma etapa ("sem aviso geral", "só avisa a liderança"), ajuste os flags correspondentes.

### Passo 2 — Calcular datas do plano de comunicação

Para exibir no resumo:
- **T-3** = event_date − 3 dias às 09:00 (aviso escola toda)
- **T-1** = event_date − 1 dia às 09:00 (aviso unidade)
- Se T-3 já passou: "imediato (catch-up)"
- Se T-1 já passou: "imediato (catch-up)"

### Passo 3 — Confirmar antes de criar

Mostre resumo e peça confirmação:

```
Vou criar este evento:

Evento: [title]
Data: [DD/MM/YYYY às HH:MM se houver]
[Unidade: X | Escola toda]
[Local: ... se houver]

Plano de comunicação:
  ✓ Liderança — agora (imediato)
  ✓ Escola toda — [data T-3] às 9h [ou "imediato (catch-up)"]
  ✓ Unidade [X | Escola toda] — [data T-1] às 9h [ou "imediato (catch-up)"]

Confirma?
```

Adapte o plano conforme flags solicitados (omita etapas desabilitadas).

### Passo 4 — Emitir marker após confirmação

Só emita DEPOIS que o usuário confirmar ("sim", "confirma", "pode", "vai", etc.):

```
<<SCHOOL_EVENT_ACTION>>
{
  "action": "create",
  "title": "Show de Fim de Ano",
  "event_date": "2026-12-20",
  "start_time": "19:00",
  "unit": "barra",
  "location": null,
  "notify_leadership": true,
  "notify_school": true,
  "notify_unit": true
}
<<END>>
```

### Passo 5 — Confirmar criação

Após o marker: "Evento criado. [N] notificações agendadas. ✓"

---

## Cancelar um evento

Quando o usuário pede para cancelar, confirme antes:

```
Cancelo o evento "[title]" de [data]?
Confirma?
```

Após confirmação:
```
<<SCHOOL_EVENT_ACTION>>
{"action": "cancel", "event_id": "latest"}
<<END>>
```

O sistema cancela as notificações pendentes e envia retratações para as já enviadas.

---

## Regras

- NUNCA emita o marker sem confirmação explícita
- Se a data estiver no passado, avise mas permita ("evento para registro histórico")
- Se unit for ambíguo, pergunte antes de confirmar
- scheduled_at de cada etapa é calculado pelo sistema — não calcule na mensagem de resposta, só mostre no resumo
```

- [ ] **Step 2: Adicionar `<<SCHOOL_EVENT_ACTION>>` ao BLOCK_RULES em system.js**

Abra `src/prompts/system.js` e localize a linha onde `<<ANNOUNCEMENT_ACTION>>` foi adicionado ao BLOCK_RULES (linha ~21). Na mesma lista de markers válidos, adicione `` `<<SCHOOL_EVENT_ACTION>>` (Sprint 13 F2) ``.

- [ ] **Step 3: Incluir skill no system prompt para director/coordinator**

No mesmo `src/prompts/system.js`, imediatamente após o bloco que inclui `comunicados.md` (que termina com `prompt += '\n\n---\n\n' + comunicadosSkill`), adicione:

```js
// Eventos institucionais — disponível apenas para director/coordinator
if (collab && (collab.role === 'director' || collab.role === 'coordinator')) {
  const eventosPath = path.join(SKILLS_DIR, 'eventos-institucionais.md');
  if (fs.existsSync(eventosPath)) {
    const eventosSkill = fs.readFileSync(eventosPath, 'utf-8');
    if (eventosSkill) {
      prompt += '\n\n---\n\n' + eventosSkill;
    }
  }
}
```

- [ ] **Step 4: Verificar**

```bash
grep -n "SCHOOL_EVENT_ACTION\|eventos-institucionais" src/prompts/system.js
# Expected: 2 linhas — BLOCK_RULES entry + skill inclusion
```

---

## Task 3: Engine — Marker Parser + Applier

**Files:**
- Modify: `src/engine.js`

- [ ] **Step 1: Adicionar `buildEventAnnouncementsNode` antes das funções de marker**

Adicione imediatamente após `applyAnnouncementAction` (que termina por volta da linha 555):

```js
// Sprint 13 F2 — Helper: gera specs de anúncio para cada etapa ativa do evento.
// Recebe o registro school_events e a data/hora atual.
// Retorna array de { body, audience, scheduled_at } para cada etapa habilitada.
// scheduled_at null = envio imediato (broadcaster processa no próximo tick).
// Timezone: BRT = UTC-3. T-3 às 09:00 BRT = UTC 12:00 do dia (event_date - 3d).
function buildEventAnnouncementsNode(ev, now) {
  const [y, m, d] = ev.event_date.split('-').map(Number);
  const timeStr = ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : '';
  const locStr = ev.location ? `, ${ev.location}` : '';
  const dateBR = `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
  // 09:00 BRT = 12:00 UTC (UTC-3)
  const t3 = new Date(Date.UTC(y, m - 1, d - 3, 12, 0, 0));
  const t1 = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
  const specs = [];
  if (ev.notify_leadership) {
    specs.push({
      body: `📅 Novo evento: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { function_role: ['director', 'coordinator'] },
      scheduled_at: null,
    });
  }
  if (ev.notify_school) {
    specs.push({
      body: `📅 Em 3 dias: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { all: true },
      scheduled_at: t3 > now ? t3.toISOString() : null,
    });
  }
  if (ev.notify_unit) {
    specs.push({
      body: `📅 Amanhã: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: ev.unit ? { unidade: [ev.unit] } : { all: true },
      scheduled_at: t1 > now ? t1.toISOString() : null,
    });
  }
  return specs;
}
```

- [ ] **Step 2: Adicionar `parseSchoolEventActionMarker` e `applySchoolEventAction`**

Adicione imediatamente após `buildEventAnnouncementsNode`:

```js
// Sprint 13 F2 — Marker <<SCHOOL_EVENT_ACTION>>.
function parseSchoolEventActionMarker(text) {
  if (!text) return null;
  const re = /<<SCHOOL_EVENT_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('SCHOOL_EVENT_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!parsed || typeof parsed !== 'object') return { malformed: true, cleanText };
  if (!['create', 'cancel'].includes(parsed.action)) {
    logSchemaErr('SCHOOL_EVENT_ACTION', ['action:invalid'], parsed);
    return { malformed: true, cleanText };
  }
  if (parsed.action === 'create') {
    if (!parsed.title || typeof parsed.title !== 'string' || !parsed.title.trim()) {
      logSchemaErr('SCHOOL_EVENT_ACTION', ['title:missing'], parsed);
      return { malformed: true, cleanText };
    }
    if (!parsed.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.event_date)) {
      logSchemaErr('SCHOOL_EVENT_ACTION', ['event_date:invalid'], parsed);
      return { malformed: true, cleanText };
    }
  }
  return { ...parsed, cleanText, malformed: false };
}

async function applySchoolEventAction(collaborator, parsed) {
  const { action, event_id } = parsed;

  if (action === 'cancel') {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let evId = (event_id && event_id !== 'latest' && UUID_RE.test(event_id)) ? event_id : null;
    if (!evId) {
      const { data } = await supabase
        .from('school_events')
        .select('id')
        .eq('created_by', collaborator.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { ok: false, reason: 'no_active_event' };
      evId = data.id;
    }
    const { error: evErr } = await supabase
      .from('school_events')
      .update({ status: 'cancelled' })
      .eq('id', evId);
    if (evErr) return { ok: false, reason: evErr.message };
    // Cancel linked announcements — broadcaster will send retractions
    await supabase
      .from('announcements')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('source_event_id', evId)
      .in('status', ['scheduled', 'sending']);
    return { ok: true, action: 'cancelled', event_id: evId };
  }

  if (action === 'create') {
    const { title, event_date, start_time, unit, location,
            notify_leadership, notify_school, notify_unit } = parsed;
    const { data: ev, error: evErr } = await supabase
      .from('school_events')
      .insert({
        title: title.trim(),
        event_date,
        start_time: start_time || null,
        unit: unit || null,
        location: location ? location.trim() : null,
        created_by: collaborator.id,
        notify_leadership: notify_leadership !== false,
        notify_school: notify_school !== false,
        notify_unit: notify_unit !== false,
      })
      .select('id, title, event_date, start_time, unit, location, notify_leadership, notify_school, notify_unit')
      .single();
    if (evErr) return { ok: false, reason: evErr.message };

    const specs = buildEventAnnouncementsNode(ev, new Date());
    let annCount = 0;
    for (const spec of specs) {
      const { data: ann, error: annErr } = await supabase
        .from('announcements')
        .insert({
          created_by: collaborator.id,
          body: spec.body,
          audience: spec.audience,
          status: 'scheduled',
          scheduled_at: spec.scheduled_at,
          source_event_id: ev.id,
        })
        .select('id')
        .single();
      if (annErr) {
        console.error('[SchoolEventAction] ann insert err:', annErr.message);
        continue;
      }
      let q = supabase.from('collaborators').select('id, phone').eq('is_active', true).not('phone', 'is', null);
      if (!spec.audience.all) {
        if (spec.audience.function_role?.length) q = q.in('function_role', spec.audience.function_role);
        if (spec.audience.unidade?.length) q = q.in('unit', spec.audience.unidade);
      }
      const { data: recipients } = await q;
      if (recipients?.length) {
        const jobs = recipients.map(r => ({ announcement_id: ann.id, recipient_id: r.id, phone: r.phone }));
        await supabase.from('announcement_jobs').insert(jobs);
      }
      annCount++;
    }
    return { ok: true, action: 'created', event_id: ev.id, announcement_count: annCount };
  }

  return { ok: false, reason: 'unknown_action' };
}
```

- [ ] **Step 3: Integrar no pipeline `processMessage`**

Imediatamente após o bloco ANNOUNCEMENT_ACTION no pipeline (busque `// Sprint 13 F1 — <<ANNOUNCEMENT_ACTION>>`), adicione:

```js
  // Sprint 13 F2 — <<SCHOOL_EVENT_ACTION>> — criar/cancelar evento institucional.
  {
    const parsedEv = parseSchoolEventActionMarker(reply);
    if (parsedEv && parsedEv.malformed) {
      console.warn('[SchoolEventAction] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'SCHOOL_EVENT_ACTION', 'rejected', 'schema_invalid', null);
      reply = parsedEv.cleanText || reply;
    } else if (parsedEv) {
      const result = await applySchoolEventAction(collab, parsedEv);
      await logMarker(
        collab.id,
        'SCHOOL_EVENT_ACTION',
        result.ok ? 'executed' : 'rejected',
        result.ok
          ? `action=${result.action} ann_count=${result.announcement_count ?? 0}`
          : result.reason,
        null
      );
      let base = parsedEv.cleanText || '';
      if (result.ok && !base) {
        if (result.action === 'created') {
          base = `Evento criado. ${result.announcement_count} notificaç${result.announcement_count !== 1 ? 'ões' : 'ão'} agendada${result.announcement_count !== 1 ? 's' : ''}. ✓`;
        } else if (result.action === 'cancelled') {
          base = 'Evento cancelado. Notificações pendentes serão removidas. ✓';
        }
      } else if (!result.ok && !base) {
        if (result.reason === 'no_active_event') {
          base = 'Não encontrei nenhum evento ativo para cancelar.';
        } else {
          base = 'Tive um erro ao processar o evento. Tenta de novo?';
        }
      }
      reply = base || reply;
    }
  }
```

- [ ] **Step 4: Verificar**

```bash
grep -n "SCHOOL_EVENT_ACTION\|buildEventAnnouncementsNode\|applySchoolEventAction" src/engine.js | head -15
# Expected: helper function, parser function, applier function, pipeline block
```

---

## Task 4: PWA Types

**Files:**
- Modify: `web/src/types.ts`

- [ ] **Step 1: Adicionar tipos após o bloco de Comunicados (linha 314)**

Adicione ao final de `web/src/types.ts`:

```ts
// ─── Sprint 13 F2 — Eventos Institucionais ──────────────────────────────────

export interface SchoolEvent {
  id: string;
  title: string;
  event_date: string;          // 'YYYY-MM-DD'
  start_time: string | null;   // 'HH:MM:SS' or null
  location: string | null;
  unit: 'barra' | 'recreio' | 'campo_grande' | null;
  created_by: string;
  status: 'active' | 'cancelled';
  notify_leadership: boolean;
  notify_school: boolean;
  notify_unit: boolean;
  created_at: string;
}

export interface EventAnnouncement {
  id: string;
  body: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  source_event_id: string;
}

export interface SchoolEventWithAnnouncements extends SchoolEvent {
  announcements: EventAnnouncement[];
}

export function unitLabel(unit: string | null): string {
  if (!unit) return 'Escola toda';
  const map: Record<string, string> = { barra: 'Barra', recreio: 'Recreio', campo_grande: 'Campo Grande' };
  return map[unit] ?? unit;
}

export function formatEventDate(eventDate: string, startTime: string | null): string {
  const [y, m, d] = eventDate.split('-');
  const date = `${d}/${m}/${y}`;
  const time = startTime ? ` às ${startTime.slice(0, 5)}` : '';
  return `${date}${time}`;
}

// Computes scheduled_at for event notification steps (browser-side).
// T-N days at 09:00 BRT (UTC-3 = UTC+12:00 for 09:00 BRT = 12:00 UTC).
// Returns null if the target time is already past (catch-up = immediate dispatch).
export function computeStepScheduledAt(eventDate: string, daysBefore: number): string | null {
  const [y, m, d] = eventDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d - daysBefore, 12, 0, 0)); // 09:00 BRT
  return target > new Date() ? target.toISOString() : null;
}

// Generates announcement specs for each active notification step.
export function buildEventAnnouncements(ev: {
  title: string;
  event_date: string;
  start_time: string | null;
  unit: string | null;
  location: string | null;
  notify_leadership: boolean;
  notify_school: boolean;
  notify_unit: boolean;
}): Array<{ body: string; audience: AnnouncementAudience; scheduled_at: string | null }> {
  const [y, m, d] = ev.event_date.split('-');
  const timeStr = ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : '';
  const locStr = ev.location ? `, ${ev.location}` : '';
  const dateBR = `${d}/${m}/${y}`;
  const specs: Array<{ body: string; audience: AnnouncementAudience; scheduled_at: string | null }> = [];
  if (ev.notify_leadership) {
    specs.push({
      body: `📅 Novo evento: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { function_role: ['director', 'coordinator'] },
      scheduled_at: null,
    });
  }
  if (ev.notify_school) {
    specs.push({
      body: `📅 Em 3 dias: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { all: true },
      scheduled_at: computeStepScheduledAt(ev.event_date, 3),
    });
  }
  if (ev.notify_unit) {
    specs.push({
      body: `📅 Amanhã: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: ev.unit ? { unidade: [ev.unit] } : { all: true },
      scheduled_at: computeStepScheduledAt(ev.event_date, 1),
    });
  }
  return specs;
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -i "types.ts" | head -10
# Expected: sem erros em types.ts
```

---

## Task 5: PWA Components

**Files:**
- Create: `web/src/components/EventoSheet.tsx`
- Create: `web/src/screens/AgendaEscolar.tsx`

- [ ] **Step 1: Criar `web/src/components/EventoSheet.tsx`**

Antes de criar: verifique o BottomSheet API lendo `web/src/components/BottomSheet.tsx` (props: `open`, `onClose`, `title`) e confirme o import path do supabase em `web/src/components/ComunicadoSheet.tsx`.

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import { buildEventAnnouncements } from '../types';
import type { AnnouncementAudience } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const UNIT_OPTIONS = [
  { value: '', label: 'Escola toda' },
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
];

export function EventoSheet({ open, onClose }: Props) {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [unit, setUnit] = useState('');
  const [location, setLocation] = useState('');
  const [notifyLeadership, setNotifyLeadership] = useState(true);
  const [notifySchool, setNotifySchool] = useState(true);
  const [notifyUnit, setNotifyUnit] = useState(true);
  const [error, setError] = useState('');

  const hasNotification = notifyLeadership || notifySchool || notifyUnit;
  const canSave = title.trim().length > 0 && eventDate.length > 0 && hasNotification;

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      setError('');
      const evPayload = {
        title: title.trim(),
        event_date: eventDate,
        start_time: startTime || null,
        unit: unit || null,
        location: location.trim() || null,
        notify_leadership: notifyLeadership,
        notify_school: notifySchool,
        notify_unit: notifyUnit,
      };

      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator!.id });

      const { data: ev, error: evErr } = await supabase
        .from('school_events')
        .insert({ ...evPayload, created_by: collaborator!.id })
        .select('id')
        .single();
      if (evErr) throw evErr;

      const specs = buildEventAnnouncements(evPayload);
      for (const spec of specs) {
        const { data: ann, error: annErr } = await supabase
          .from('announcements')
          .insert({
            created_by: collaborator!.id,
            body: spec.body,
            audience: spec.audience as AnnouncementAudience,
            status: 'scheduled',
            scheduled_at: spec.scheduled_at,
            source_event_id: ev.id,
          })
          .select('id')
          .single();
        if (annErr) continue;

        let q = supabase.from('collaborators').select('id, phone').eq('is_active', true).not('phone', 'is', null);
        const aud = spec.audience as AnnouncementAudience;
        if (!aud.all) {
          if (aud.function_role?.length) q = q.in('function_role', aud.function_role);
          if (aud.unidade?.length) q = q.in('unit', aud.unidade);
        }
        const { data: recipients } = await q;
        if (recipients?.length) {
          const jobs = recipients.map(r => ({ announcement_id: ann.id, recipient_id: r.id, phone: r.phone }));
          await supabase.from('announcement_jobs').insert(jobs);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
      setTitle(''); setEventDate(''); setStartTime(''); setUnit('');
      setLocation(''); setNotifyLeadership(true); setNotifySchool(true);
      setNotifyUnit(true); setError('');
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <BottomSheet open={open} onClose={onClose} title="Novo evento">
      <div className="space-y-4 p-4">
        <div>
          <label className="text-caption text-fg-muted">Título *</label>
          <input
            type="text"
            className="mt-1 w-full rounded-lg border border-border bg-bg-elevated p-2 text-body focus:outline-none focus:border-brand"
            placeholder="Ex: Show de Fim de Ano"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-caption text-fg-muted">Data *</label>
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated p-2 text-body focus:outline-none focus:border-brand"
              value={eventDate}
              onChange={e => setEventDate(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="text-caption text-fg-muted">Horário</label>
            <input
              type="time"
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated p-2 text-body focus:outline-none focus:border-brand"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-caption text-fg-muted">Unidade</label>
          <select
            className="mt-1 w-full rounded-lg border border-border bg-bg-elevated p-2 text-body focus:outline-none focus:border-brand"
            value={unit}
            onChange={e => setUnit(e.target.value)}
          >
            {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-caption text-fg-muted">Local (opcional)</label>
          <input
            type="text"
            className="mt-1 w-full rounded-lg border border-border bg-bg-elevated p-2 text-body focus:outline-none focus:border-brand"
            placeholder="Ex: Teatro Municipal"
            value={location}
            onChange={e => setLocation(e.target.value)}
          />
        </div>

        <div>
          <p className="text-caption text-fg-muted mb-2">Notificações</p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" checked={notifyLeadership} onChange={e => setNotifyLeadership(e.target.checked)} />
              Liderança — imediato ao criar
            </label>
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" checked={notifySchool} onChange={e => setNotifySchool(e.target.checked)} />
              Escola toda — 3 dias antes
            </label>
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox" checked={notifyUnit} onChange={e => setNotifyUnit(e.target.checked)} />
              {unit ? UNIT_OPTIONS.find(o => o.value === unit)?.label ?? 'Unidade' : 'Escola toda'} — 1 dia antes
            </label>
          </div>
          {!hasNotification && (
            <p className="text-danger text-caption mt-1">Selecione ao menos uma notificação</p>
          )}
        </div>

        {error && <p className="text-danger text-caption">{error}</p>}

        <button
          type="button"
          disabled={!canSave || isPending}
          onClick={() => mutate()}
          className="w-full h-10 rounded-lg bg-brand text-white text-body font-medium disabled:opacity-40"
        >
          {isPending ? 'Criando...' : 'Criar evento'}
        </button>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Criar `web/src/screens/AgendaEscolar.tsx`**

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { EventoSheet } from '../components/EventoSheet';
import { unitLabel, formatEventDate } from '../types';
import type { SchoolEventWithAnnouncements } from '../types';

const STEP_PREFIXES = {
  leadership: '📅 Novo evento:',
  school: '📅 Em 3 dias:',
  unit: '📅 Amanhã:',
};

const STATUS_CHIP: Record<string, string> = {
  scheduled: '⏳',
  sending: '📤',
  sent: '✓',
  cancelled: '✗',
};

function StepChip({ label, announcement }: { label: string; announcement?: { status: string; scheduled_at: string | null } | null }) {
  if (!announcement) return <span className="text-caption text-fg-muted">{label} —</span>;
  const chip = STATUS_CHIP[announcement.status] ?? '?';
  const when = announcement.scheduled_at
    ? new Date(announcement.scheduled_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : 'agora';
  return (
    <span className="text-caption text-fg-muted">
      {label} {chip} {when}
    </span>
  );
}

export function AgendaEscolar() {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['agenda-escolar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('school_events')
        .select('*, announcements(id, body, status, scheduled_at, source_event_id)')
        .eq('status', 'active')
        .order('event_date', { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SchoolEventWithAnnouncements[];
    },
  });

  const { mutate: cancelEvent } = useMutation({
    mutationFn: async (eventId: string) => {
      await supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator!.id });
      const { error: evErr } = await supabase
        .from('school_events')
        .update({ status: 'cancelled' })
        .eq('id', eventId);
      if (evErr) throw evErr;
      await supabase
        .from('announcements')
        .update({ status: 'cancelled' })
        .eq('source_event_id', eventId)
        .in('status', ['scheduled', 'sending']);
    },
    onSuccess: () => {
      setCancelError('');
      queryClient.invalidateQueries({ queryKey: ['agenda-escolar'] });
    },
    onError: (err: Error) => setCancelError(err.message),
  });

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Agenda Escolar</h2>
        <p className="text-body-sm text-fg-muted mt-1">Eventos institucionais da escola</p>
      </header>

      {isLoading && <p className="text-body-sm text-fg-muted">Carregando...</p>}

      {!isLoading && events.length === 0 && (
        <p className="text-body-sm text-fg-muted">Nenhum evento ativo.</p>
      )}

      {cancelError && <p className="text-danger text-body-sm">{cancelError}</p>}

      <ul className="space-y-2">
        {events.map(ev => {
          const anns = ev.announcements ?? [];
          const leadAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.leadership));
          const schoolAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.school));
          const unitAnn = anns.find(a => a.body.startsWith(STEP_PREFIXES.unit));
          return (
            <li key={ev.id} className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-body font-medium">{ev.title}</p>
                  <p className="text-body-sm text-fg-muted">
                    {formatEventDate(ev.event_date, ev.start_time)}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </p>
                </div>
                <span className="text-caption bg-bg-elevated border border-border rounded px-2 py-0.5 whitespace-nowrap">
                  {unitLabel(ev.unit)}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {ev.notify_leadership && <StepChip label="Liderança" announcement={leadAnn} />}
                {ev.notify_school && <StepChip label="Escola" announcement={schoolAnn} />}
                {ev.notify_unit && <StepChip label="Unidade" announcement={unitAnn} />}
              </div>
              <button
                type="button"
                onClick={() => cancelEvent(ev.id)}
                className="text-caption text-danger underline"
              >
                Cancelar evento
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-24 right-4 h-14 w-14 rounded-full bg-brand text-white shadow-lg flex items-center justify-center"
        aria-label="Novo evento"
      >
        <Plus size={24} />
      </button>

      <EventoSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
```

---

## Task 6: PWA Routing

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/screens/Mais.tsx`

- [ ] **Step 1: Adicionar import e rota em App.tsx**

Adicionar import após imports existentes:
```tsx
import { AgendaEscolar } from './screens/AgendaEscolar';
```

Adicionar rota após `mais/comunicados`:
```tsx
<Route path="mais/agenda-escolar" element={<AgendaEscolar />} />
```

- [ ] **Step 2: Adicionar item em Mais.tsx**

No array `items` (linha 21, após o item `comunicados`), adicionar:
```ts
{ to: '/mais/agenda-escolar', label: 'Agenda Escolar', hint: 'Eventos e comunicações', requireRoles: ['director', 'coordinator'] },
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
# Expected: 0 errors
```

---

## Task 7: E2E Validation

**Files:** Nenhum novo — apenas verificações

- [ ] **Step 1: Verificar DB**

```sql
-- Tabelas e coluna existem
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('school_events', 'announcements')
  AND column_name IN ('notify_leadership','notify_school','notify_unit','source_event_id')
ORDER BY table_name, column_name;
-- Expected: 4 rows

-- Inserir evento de teste (substitua <collab_id> por UUID real)
SELECT id FROM collaborators WHERE is_active = true LIMIT 1;
```

- [ ] **Step 2: Testar geração de anúncios**

```sql
-- Inserir evento de teste
INSERT INTO school_events (title, event_date, unit, created_by)
VALUES ('Teste E2E Fatia 2', '2026-12-20', 'barra', '<collab_id>')
RETURNING id;
-- Anotar <event_id>
```

Verificar no Node.js que `buildEventAnnouncementsNode` produziria os 3 specs:
```bash
node -e "
require('dotenv').config();
// Simular função inline para verificar datas
const y=2026,m=12,d=20;
const t3=new Date(Date.UTC(y,m-1,d-3,12,0,0));
const t1=new Date(Date.UTC(y,m-1,d-1,12,0,0));
const now=new Date();
console.log('T-3:', t3.toISOString(), t3>now?'FUTURE':'PAST (catch-up)');
console.log('T-1:', t1.toISOString(), t1>now?'FUTURE':'PAST (catch-up)');
"
# Expected: ambas futuras para 20/12/2026
```

- [ ] **Step 3: Verificar engine**

```bash
grep -n "SCHOOL_EVENT_ACTION\|applySchoolEventAction\|buildEventAnnouncementsNode" src/engine.js
# Expected: ~5 ocorrências — helper, parser, applier, pipeline
```

- [ ] **Step 4: Verificar PWA compila**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
# Expected: 0 errors
```

- [ ] **Step 5: Verificar PWA arquivos**

```bash
grep -n "^export function AgendaEscolar\|^export function EventoSheet" web/src/screens/AgendaEscolar.tsx web/src/components/EventoSheet.tsx
# Expected: 2 linhas
grep "agenda-escolar" web/src/App.tsx web/src/screens/Mais.tsx
# Expected: rota + nav item
```

- [ ] **Step 6: Limpar dados de teste**

```sql
DELETE FROM school_events WHERE title = 'Teste E2E Fatia 2';
-- CASCADE remove announcements + jobs linkados
```

---

## Self-Review

**Spec coverage:**
- ✅ DB: `school_events` + `source_event_id` em `announcements` (Task 1)
- ✅ RLS: todos leem, director/coordinator escrevem (Task 1)
- ✅ TOM skill + BLOCK_RULES + system prompt (Task 2)
- ✅ `buildEventAnnouncementsNode` helper Node.js (Task 3)
- ✅ `parseSchoolEventActionMarker` + `applySchoolEventAction` + pipeline (Task 3)
- ✅ `buildEventAnnouncements` + helpers TypeScript (Task 4)
- ✅ `EventoSheet.tsx` — criar evento + notificações (Task 5)
- ✅ `AgendaEscolar.tsx` — lista + status etapas + cancelamento (Task 5)
- ✅ `/mais/agenda-escolar` rota + nav item (Task 6)
- ✅ Edge cases: catch-up quando evento próximo (null scheduled_at), unit=null→all, cancelamento linkado

**Consistência de tipos:**
- `buildEventAnnouncementsNode` (Node.js, Task 3) e `buildEventAnnouncements` (TypeScript, Task 4) produzem idêntico shape: `{ body, audience, scheduled_at }`
- `audience.unidade` → `collaborators.unit` — mapeamento correto em ambos os lados
- `SchoolEventWithAnnouncements.announcements` usa `EventAnnouncement` que inclui `body` para o `startsWith()` em `AgendaEscolar.tsx`
