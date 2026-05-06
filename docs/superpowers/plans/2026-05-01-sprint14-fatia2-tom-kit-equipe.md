# Sprint 14 Fatia 2 — TOM Kit + Mapa de Equipe + Lembretes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-gerar tasks de evento via TOM (5 kits hardcoded), mapear responsáveis por setor/unidade, e enviar lembretes WhatsApp T-1.

**Architecture:** 3 colunas/tabelas DB (`event_type`, `event_team_map`, `reminded_at`); kits estáticos em `engine.js`; bloco novo no `dispatcher.js` para lembretes; skill TOM atualizada com `event_type`; tela PWA `/mais/agenda-escolar/equipe`.

**Tech Stack:** Supabase MCP (migration), Node.js (engine, dispatcher), React + TypeScript (PWA), markdown (TOM skill).

**Spec:** `docs/superpowers/specs/2026-05-01-sprint14-fatia2-tom-kit-equipe-design.md`

**Note:** Sem git local — sem `git commit` no fim de cada task. Validação: leitura estática + `npx tsc --noEmit` + smoke tests SQL + smoke test em browser. Deploy via scp ao final.

---

## Codebase Context

**`src/engine.js`** linhas 823-949: `parseSchoolEventActionMarker(text)` (validador JSON do marker) + `applySchoolEventAction(collaborator, parsed)` (executa create/cancel). Nas linhas 886-888, no branch `create`, o objeto `parsed` é destruturado para extrair os campos. O INSERT em `school_events` está nas linhas 889-904. **A geração do kit deve ocorrer logo APÓS esse INSERT, antes do loop de `buildEventAnnouncementsNode`.**

**`src/rituals/dispatcher.js`** linha 521: `dispatchAnnouncements(now)` mostra o pattern `whatsapp.sendMessage(phone, body)` (`whatsapp = require('../services/whatsapp')` na linha 522). Linhas 758-763: chamada de `dispatchAnnouncements` no `run()`. **O novo `remindEventTasks` deve ser chamado no `run()` antes de `dispatchAnnouncements`.**

**`skills/eventos-institucionais.md`**: skill TOM atual com 4 campos `notify_*` no marker. Adicionar `event_type` ao marker e à lógica de extração.

**`web/src/screens/AgendaEscolar.tsx`**: card de evento com link "Tarefas do evento" (Fatia 1). Adicionar botão "Equipe" no header da tela.

**`web/src/App.tsx`** linha 43-44: rotas dentro de `mais/`. Adicionar rota nova.

**Supabase project:** `cesnbnrynvxvgdhfmaua`. RLS helper `current_collab_role()` já existe.

**Tabela `tasks` (relevante para Fatia 2):** `source` CHECK aceita `manual|agent_briefing|agent_closing|checkpoint_decomposition|coordinator_assignment|system`. `system` é o valor para tasks geradas pelo kit.

---

## File Structure

**Modified:**
- `supabase` — migration nova (via MCP)
- `D:\la-organizer\_remote\src\engine.js` — kit definitions, `buildEventTaskKit`, `parseSchoolEventActionMarker`, `applySchoolEventAction`
- `D:\la-organizer\_remote\src\rituals\dispatcher.js` — `remindEventTasks` + chamada em `run()`
- `D:\la-organizer\_remote\skills\eventos-institucionais.md` — `event_type` no marker
- `D:\la-organizer\_remote\web\src\screens\AgendaEscolar.tsx` — botão "Equipe"
- `D:\la-organizer\_remote\web\src\App.tsx` — rota `/mais/agenda-escolar/equipe`

**Created:**
- `D:\la-organizer\_remote\web\src\screens\ConfigurarEquipe.tsx` — tela nova

---

## Task 1: DB Migration

- [ ] **Step 1: Aplicar migration**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration` com project_id `cesnbnrynvxvgdhfmaua`, name `sprint14_fatia2_kit_equipe`:

```sql
-- 1. event_type em school_events (nullable — null = sem kit)
ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS event_type text
    CHECK (event_type IN ('show','recital','workshop','treinamento','oficinas','reuniao','formatura','evento'));

-- 2. event_team_map — mapa por (unit, sector)
CREATE TABLE IF NOT EXISTS event_team_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit            text NOT NULL CHECK (unit IN ('barra','recreio','campo_grande')),
  sector          text NOT NULL CHECK (sector IN ('logistica','tecnica','pedagogico','comunicacao','producao')),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit, sector)
);

CREATE INDEX IF NOT EXISTS event_team_map_unit_idx ON event_team_map(unit);

-- 3. reminded_at em tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz;

-- 4. RLS para event_team_map (director e coordinator)
ALTER TABLE event_team_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_team_map_read ON event_team_map;
CREATE POLICY event_team_map_read ON event_team_map
  FOR SELECT USING (current_collab_role() IN ('coordinator','director'));

DROP POLICY IF EXISTS event_team_map_write ON event_team_map;
CREATE POLICY event_team_map_write ON event_team_map
  FOR ALL USING (current_collab_role() IN ('coordinator','director'));
```

- [ ] **Step 2: Verificar `event_type` em `school_events`**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'school_events' AND column_name = 'event_type';
```

Expected: 1 row, `data_type = text`, `is_nullable = YES`.

- [ ] **Step 3: Verificar tabela `event_team_map`**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'event_team_map' ORDER BY ordinal_position;
```

Expected: 6 rows (id, unit, sector, collaborator_id, created_at, updated_at).

- [ ] **Step 4: Verificar `reminded_at` em `tasks`**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'reminded_at';
```

Expected: 1 row, `data_type = timestamp with time zone`, `is_nullable = YES`.

- [ ] **Step 5: Verificar RLS policies**

```sql
SELECT polname FROM pg_policy WHERE polrelid = 'event_team_map'::regclass;
```

Expected: 2 rows: `event_team_map_read` e `event_team_map_write`.

---

## Task 2: Engine — kits hardcoded + `buildEventTaskKit`

**Files:** Modify `D:\la-organizer\_remote\src\engine.js`

- [ ] **Step 1: Adicionar definições do kit ANTES de `parseSchoolEventActionMarker`**

Localize a linha 823 (`function parseSchoolEventActionMarker(text)`). Logo ANTES dela, insira:

```js
// ─── Sprint 14 Fatia 2 — Kits de tasks de evento ─────────────────────────────

const TYPE_TO_FAMILY = {
  show: 'performance', recital: 'performance',
  workshop: 'aprendizagem', treinamento: 'aprendizagem', oficinas: 'aprendizagem',
  reuniao: 'reuniao',
  formatura: 'formatura',
  evento: 'evento',
};

const EVENT_TASK_KITS = {
  performance: [
    { title: 'Confirmar local e montagem do espaço',          sector: 'logistica'   },
    { title: 'Organizar lista de presença e convites',        sector: 'logistica'   },
    { title: 'Testar equipamentos de som e iluminação',       sector: 'tecnica'     },
    { title: 'Preparar roteiro técnico do evento',            sector: 'tecnica'     },
    { title: 'Realizar ensaio geral com alunos',              sector: 'pedagogico'  },
    { title: 'Confirmar repertório e ordem de apresentação',  sector: 'pedagogico'  },
    { title: 'Divulgar evento (redes sociais e WhatsApp)',    sector: 'comunicacao' },
    { title: 'Enviar convites para responsáveis',             sector: 'comunicacao' },
    { title: 'Decoração e ambientação do espaço',             sector: 'producao'    },
  ],
  aprendizagem: [
    { title: 'Confirmar sala e número de vagas',              sector: 'logistica'   },
    { title: 'Preparar materiais e impressões',               sector: 'logistica'   },
    { title: 'Verificar equipamentos audiovisuais',           sector: 'tecnica'     },
    { title: 'Finalizar conteúdo e apostilas',                sector: 'pedagogico'  },
    { title: 'Preparar dinâmica e exercícios práticos',       sector: 'pedagogico'  },
    { title: 'Confirmar inscrições e presenças',              sector: 'comunicacao' },
  ],
  reuniao: [
    { title: 'Confirmar sala e presença dos participantes',   sector: 'logistica'   },
    { title: 'Preparar pauta da reunião',                     sector: 'pedagogico'  },
    { title: 'Registrar ata durante a reunião',               sector: 'pedagogico'  },
    { title: 'Convocar participantes com antecedência',       sector: 'comunicacao' },
  ],
  formatura: [
    { title: 'Confirmar local e estrutura do espaço',         sector: 'logistica'   },
    { title: 'Organizar lista de convidados e ingressos',     sector: 'logistica'   },
    { title: 'Testar som, filmagem e fotografia',             sector: 'tecnica'     },
    { title: 'Realizar ensaio da cerimônia com formandos',    sector: 'pedagogico'  },
    { title: 'Preparar diplomas e certificados',              sector: 'pedagogico'  },
    { title: 'Enviar convites e confirmar presenças',         sector: 'comunicacao' },
    { title: 'Decoração e montagem do espaço',                sector: 'producao'    },
    { title: 'Organizar homenagens e momentos especiais',     sector: 'producao'    },
  ],
  evento: [
    { title: 'Confirmar local e estrutura',                   sector: 'logistica'   },
    { title: 'Verificar equipamentos necessários',            sector: 'tecnica'     },
    { title: 'Preparar conteúdo e programação',               sector: 'pedagogico'  },
    { title: 'Divulgar e confirmar participantes',            sector: 'comunicacao' },
    { title: 'Preparar ambientação do espaço',                sector: 'producao'    },
  ],
};

const VALID_EVENT_TYPES = Object.keys(TYPE_TO_FAMILY);
```

- [ ] **Step 2: Adicionar `buildEventTaskKit` ANTES de `parseSchoolEventActionMarker`**

Logo após o bloco do Step 1, adicione:

```js
async function buildEventTaskKit(eventId, eventDate, eventType, unit, createdBy) {
  const family = TYPE_TO_FAMILY[eventType];
  if (!family) return { ok: true, count: 0 };

  const kit = EVENT_TASK_KITS[family];
  if (!kit || !kit.length) return { ok: true, count: 0 };

  // Buscar mapa de equipe da unidade (vazio se evento for "escola toda" sem unit)
  const teamMap = {};
  if (unit) {
    const { data: mapRows } = await supabase
      .from('event_team_map')
      .select('sector, collaborator_id')
      .eq('unit', unit);
    for (const row of mapRows || []) {
      teamMap[row.sector] = row.collaborator_id;
    }
  }

  // remind_at = event_date às 09h BRT do dia ANTERIOR (T-1)
  // event_date é YYYY-MM-DD; 09h BRT = 12h UTC; subtrair 24h = dia anterior 12h UTC
  const eventDayUtc = new Date(eventDate + 'T12:00:00Z').getTime();
  const remindAtIso = new Date(eventDayUtc - 24 * 60 * 60 * 1000).toISOString();

  const tasks = kit.map(item => ({
    title: item.title,
    assigned_to: teamMap[item.sector] || createdBy,
    created_by: createdBy,
    due_date: eventDate,
    remind_at: remindAtIso,
    status: 'pending',
    source: 'system',
    context: 'work',
    priority: 'medium',
    school_event_id: eventId,
    event_sector: item.sector,
  }));

  const { error } = await supabase.from('tasks').insert(tasks);
  if (error) return { ok: false, error: error.message, count: 0 };
  return { ok: true, count: tasks.length };
}
```

- [ ] **Step 3: Adicionar validação `event_type` em `parseSchoolEventActionMarker`**

Localize a linha (~847-849) que valida `event_date` no branch `create`:

```js
    if (!parsed.event_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.event_date)) {
      logSchemaErr('SCHOOL_EVENT_ACTION', ['event_date:invalid'], parsed);
      return { malformed: true, cleanText };
    }
```

LOGO APÓS esse bloco (mas ainda dentro de `if (parsed.action === 'create')`), adicione:

```js
    if (parsed.event_type !== undefined && parsed.event_type !== null) {
      if (!VALID_EVENT_TYPES.includes(parsed.event_type)) {
        logSchemaErr('SCHOOL_EVENT_ACTION', ['event_type:invalid'], parsed);
        return { malformed: true, cleanText };
      }
    }
```

- [ ] **Step 4: Wire `buildEventTaskKit` em `applySchoolEventAction`**

Localize o INSERT em `school_events` (linhas 889-905):

```js
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
        notify_day_of: parsed.notify_day_of ?? true,
      })
```

Substitua-o por (adicionando `event_type` ao INSERT e ao select):

```js
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
        notify_day_of: parsed.notify_day_of ?? true,
        event_type: parsed.event_type || null,
      })
      .select('id, title, event_date, start_time, unit, location, notify_leadership, notify_school, notify_unit, event_type')
      .single();
    if (evErr) return { ok: false, reason: evErr.message };
```

(Substituiu o `.select(...)` antigo também — note `event_type` adicionado no select.)

- [ ] **Step 5: Chamar `buildEventTaskKit` após o INSERT do evento**

Localize a linha logo após `if (evErr) return { ok: false, reason: evErr.message };` (era linha ~905 antes da edição). ANTES de `const specs = buildEventAnnouncementsNode(ev, new Date());`, adicione:

```js
    // Sprint 14 Fatia 2 — auto-gerar kit de tasks
    let kitCount = 0;
    if (parsed.event_type) {
      const kitResult = await buildEventTaskKit(
        ev.id,
        ev.event_date,
        parsed.event_type,
        ev.unit,
        collaborator.id
      );
      if (!kitResult.ok) {
        console.error('[applySchoolEventAction] kit error:', kitResult.error);
        // best-effort — continua para criar announcements
      } else {
        kitCount = kitResult.count;
      }
    }
```

- [ ] **Step 6: Incluir `task_count` no return de sucesso**

Localize a linha:
```js
    return { ok: true, action: 'created', event_id: ev.id, announcement_count: annCount };
```

Substitua por:
```js
    return { ok: true, action: 'created', event_id: ev.id, announcement_count: annCount, task_count: kitCount };
```

- [ ] **Step 7: Verificar estaticamente**

Releia engine.js nas linhas modificadas. Confirme:
- `TYPE_TO_FAMILY` e `EVENT_TASK_KITS` definidos antes de `parseSchoolEventActionMarker`
- `buildEventTaskKit` é `async`, usa `supabase` (variável global do módulo), retorna `{ok, count, error?}`
- Validação de `event_type` no parser retorna `malformed: true` em valores inválidos
- INSERT de `school_events` inclui `event_type` E o `.select()` retorna `event_type`
- `buildEventTaskKit` é chamado APÓS INSERT e ANTES de `buildEventAnnouncementsNode`
- `kitCount` é incluído no return

- [ ] **Step 8: Smoke test manual via SQL — kit gerado corretamente**

Inserir evento + kit "à mão" para verificar que o engine vai funcionar:

```sql
-- Inserir um responsável de logística para Barra
INSERT INTO event_team_map (unit, sector, collaborator_id)
SELECT 'barra', 'logistica', id FROM collaborators WHERE role = 'coordinator' LIMIT 1
ON CONFLICT (unit, sector) DO UPDATE SET collaborator_id = EXCLUDED.collaborator_id
RETURNING id, unit, sector, collaborator_id;
```

Expected: 1 row inserida ou atualizada.

---

## Task 3: Dispatcher — `remindEventTasks`

**Files:** Modify `D:\la-organizer\_remote\src\rituals\dispatcher.js`

- [ ] **Step 1: Adicionar função `remindEventTasks` antes de `dispatchAnnouncements`**

Localize a linha 521: `async function dispatchAnnouncements(now = new Date()) {`. ANTES dela, adicione:

```js
// Sprint 14 Fatia 2 — lembretes T-1 para tasks de evento
async function remindEventTasks(now = new Date()) {
  const whatsapp = require('../services/whatsapp');
  const nowIso = now.toISOString();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select(`
      id, title, assigned_to, school_event_id,
      collaborator:assigned_to ( phone, full_name ),
      event:school_event_id ( title )
    `)
    .not('school_event_id', 'is', null)
    .in('status', ['pending', 'in_progress'])
    .lte('remind_at', nowIso)
    .is('reminded_at', null);

  if (error) {
    console.error('[remindEventTasks] query err:', error.message);
    return;
  }
  if (!tasks || tasks.length === 0) return;

  for (const task of tasks) {
    const phone = task.collaborator?.phone;
    if (!phone) {
      // Marca como notificado mesmo sem phone — evita reprocessamento infinito
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
      continue;
    }
    const firstName = (task.collaborator?.full_name || '').split(' ')[0];
    const eventTitle = task.event?.title || 'evento';
    const greeting = firstName ? `${firstName}, ` : '';
    const msg = `⏰ ${greeting}lembrete: *${task.title}* (evento *${eventTitle}*) é amanhã. Tudo certo da sua parte?`;

    try {
      await whatsapp.sendMessage(phone, msg);
      await supabase.from('tasks').update({ reminded_at: nowIso }).eq('id', task.id);
      console.log(`[remindEventTasks] sent task=${task.id.slice(0, 8)} → ${phone.slice(-4)}`);
    } catch (err) {
      console.error(`[remindEventTasks] send err task=${task.id.slice(0, 8)}:`, err.message);
      // Não marca reminded_at — tenta novamente no próximo tick
    }
  }
}
```

- [ ] **Step 2: Chamar `remindEventTasks` no `run()`**

Localize o bloco no `run()` (linhas 758-763):
```js
  // Sprint 13 F1 — comunicados internos (broadcast queue)
  try {
    await dispatchAnnouncements(new Date());
  } catch (err) {
    console.error('[Dispatcher] dispatchAnnouncements erro:', err.message);
  }
```

ANTES desse bloco, adicione:
```js
  // Sprint 14 F2 — lembretes T-1 de tasks de evento
  try {
    await remindEventTasks(new Date());
  } catch (err) {
    console.error('[Dispatcher] remindEventTasks erro:', err.message);
  }
```

- [ ] **Step 3: Exportar `remindEventTasks` no `module.exports`**

Localize a linha 1285: `module.exports = { run, dispatchChecklists, dispatchAnnouncements, notifyCoordinators, parseOnboardingMarker: undefined };`

Substitua por:
```js
module.exports = { run, dispatchChecklists, dispatchAnnouncements, notifyCoordinators, remindEventTasks, parseOnboardingMarker: undefined };
```

- [ ] **Step 4: Verificar estaticamente**

Releia o dispatcher. Confirme:
- `remindEventTasks` é definido antes de `dispatchAnnouncements`
- Query usa `.not('school_event_id', 'is', null)` (não filtra task que NÃO tem evento)
- Query filtra `status IN ('pending', 'in_progress')` — task `done`/`cancelled` não recebe lembrete
- `reminded_at` é setado no UPDATE para evitar duplicata, MESMO em failure-de-envio (false — em failure, não marca → retry no próximo tick)
- Mensagem usa `*${task.title}*` (negrito WhatsApp) e `*${eventTitle}*`
- Chamada antes de `dispatchAnnouncements` no `run()`
- Export inclui `remindEventTasks`

---

## Task 4: TOM Skill — `event_type` no marker

**Files:** Modify `D:\la-organizer\_remote\skills\eventos-institucionais.md`

- [ ] **Step 1: Adicionar `event_type` à lista de campos no Passo 1**

Localize a seção `### Passo 1 — Extrair dados do pedido` (~linha 14). Encontre a lista de campos:
```
- **title**: ...
- **event_date**: ...
- **start_time**: ...
- **unit**: ...
- **location**: ...
- **notify_leadership**: ...
- **notify_school**: ...
- **notify_unit**: ...
- **notify_day_of**: ...
```

Adicione APÓS `location` e ANTES de `notify_leadership`:

```
- **event_type**: tipo do evento, usado para auto-gerar tasks. Valores: `show` | `recital` | `workshop` | `treinamento` | `oficinas` | `reuniao` | `formatura` | `evento`. Inferir do contexto:
  - "show", "apresentação", "concerto" → `show`
  - "recital" → `recital`
  - "workshop" → `workshop`
  - "treinamento", "capacitação" → `treinamento`
  - "oficina", "oficinas" → `oficinas`
  - "reunião", "reuniao" → `reuniao`
  - "formatura", "cerimônia de conclusão" → `formatura`
  - Qualquer outro → `evento`
  - Se for impossível inferir, perguntar ao usuário: "Qual o tipo desse evento? (show, recital, workshop, treinamento, oficinas, reunião, formatura, evento)"
  - Se o usuário disser explicitamente "sem kit de tarefas" ou "não cria tarefas", emitir `null`.
```

- [ ] **Step 2: Atualizar exemplo do marker JSON**

Localize a seção que mostra o JSON do marker `<<SCHOOL_EVENT_ACTION>>` para action=create. Substitua o bloco JSON existente por:

```json
{
  "action": "create",
  "title": "Show de Fim de Ano",
  "event_date": "2026-12-20",
  "start_time": "19:00",
  "unit": "barra",
  "location": "Auditório principal",
  "event_type": "show",
  "notify_leadership": true,
  "notify_school": true,
  "notify_unit": true,
  "notify_day_of": true
}
```

- [ ] **Step 3: Adicionar linha no resumo de confirmação**

Localize o resumo de confirmação (Passo 3). Após a lista do "Plano de comunicação" com as 4 linhas (`✓ Liderança`, `✓ Escola toda`, etc.), adicione uma 5ª linha condicional:

```
[Se event_type não for null:]
  ✓ Kit de tarefas — N tarefas ([família]) atribuídas à equipe
```

Onde:
- `N` = quantidade de tasks no kit (performance=9, aprendizagem=6, reuniao=4, formatura=8, evento=5)
- `[família]` = nome da família (performance / aprendizagem / reunião / formatura / evento)

Exemplo concreto para um show:
```
  ✓ Kit de tarefas — 9 tarefas (performance) atribuídas à equipe da Barra
```

- [ ] **Step 4: Adicionar regra geral sobre o kit**

No final da skill (após a seção de cancelamento, antes de qualquer rodapé/exemplo), adicione:

```markdown
## Auto-geração de tasks (Fatia 2)

Quando `event_type` é fornecido, o engine auto-gera um kit de tasks operacionais distribuídas por setor (logística, técnica, pedagógico, comunicação, produção). Os responsáveis vêm do mapa de equipe da unidade do evento (configurável em `/mais/agenda-escolar/equipe`). Se não houver mapa para um setor, a task é atribuída ao criador do evento.

Cada task recebe `due_date = event_date` e `remind_at = T-1 09h BRT`. Um lembrete WhatsApp é enviado automaticamente ao responsável no dia anterior ao evento.

O coordinator pode editar/excluir tasks individualmente em `/mais/eventos/:id`.
```

- [ ] **Step 5: Verificar leitura**

Releia o arquivo. Confirme:
- `event_type` está na lista de campos com 8 valores válidos + null + regras de inferência
- O exemplo JSON do marker tem `event_type`
- O resumo de confirmação menciona o kit
- A seção "Auto-geração de tasks" foi adicionada

---

## Task 5: PWA — Tela `ConfigurarEquipe`

**Files:** Create `D:\la-organizer\_remote\web\src\screens\ConfigurarEquipe.tsx`

- [ ] **Step 1: Criar a tela com tabs por unidade + grid de selects**

Crie o arquivo com este conteúdo:

```tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { SECTORS, SECTOR_LABELS } from '../types';
import type { EventSector } from '../types';

type Unit = 'barra' | 'recreio' | 'campo_grande';

const UNITS: Unit[] = ['barra', 'recreio', 'campo_grande'];
const UNIT_LABELS: Record<Unit, string> = {
  barra: 'Barra',
  recreio: 'Recreio',
  campo_grande: 'Campo Grande',
};

interface CollabOption {
  id: string;
  full_name: string;
}

export function ConfigurarEquipe() {
  const { collaborator } = useAuth();
  const queryClient = useQueryClient();
  const [unit, setUnit] = useState<Unit>('barra');
  const [draft, setDraft] = useState<Record<EventSector, string>>({
    logistica: '', tecnica: '', pedagogico: '', comunicacao: '', producao: '',
  });
  const [feedback, setFeedback] = useState<string>('');

  const { data: collabs = [] } = useQuery({
    queryKey: ['collaborators-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CollabOption[];
    },
  });

  const { data: mapRows = [], isLoading } = useQuery({
    queryKey: ['event-team-map', unit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_team_map')
        .select('sector, collaborator_id')
        .eq('unit', unit);
      if (error) throw error;
      return (data ?? []) as { sector: EventSector; collaborator_id: string }[];
    },
  });

  // Sync draft when unit changes or query loads
  useEffect(() => {
    const next: Record<EventSector, string> = {
      logistica: '', tecnica: '', pedagogico: '', comunicacao: '', producao: '',
    };
    for (const row of mapRows) {
      next[row.sector] = row.collaborator_id;
    }
    setDraft(next);
    setFeedback('');
  }, [unit, mapRows]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setFeedback('');
      await supabase.rpc('set_config', {
        key: 'app.current_user_id',
        value: collaborator!.id,
      });

      const toDelete = SECTORS.filter(s => !draft[s]);
      const toUpsert = SECTORS.filter(s => draft[s]).map(s => ({
        unit,
        sector: s,
        collaborator_id: draft[s],
      }));

      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from('event_team_map')
          .delete()
          .eq('unit', unit)
          .in('sector', toDelete);
        if (delErr) throw delErr;
      }
      if (toUpsert.length) {
        const { error: upErr } = await supabase
          .from('event_team_map')
          .upsert(toUpsert, { onConflict: 'unit,sector' });
        if (upErr) throw upErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-team-map', unit] });
      setFeedback('Salvo com sucesso.');
    },
    onError: (err: Error) => setFeedback('Erro: ' + err.message),
  });

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Link to="/mais/agenda-escolar" className="text-caption text-fg-muted underline">
          ← Voltar
        </Link>
        <h2 className="text-title text-fg">Equipe por Setor</h2>
        <p className="text-body-sm text-fg-muted">
          Define o responsável padrão por setor em cada unidade. Tasks de eventos são atribuídas
          automaticamente a esses responsáveis no momento da criação.
        </p>
      </header>

      <div className="flex gap-2 border-b border-border">
        {UNITS.map(u => (
          <button
            key={u}
            type="button"
            onClick={() => setUnit(u)}
            className={[
              'px-3 py-2 text-body focus-ring',
              u === unit
                ? 'border-b-2 border-brand text-fg font-medium'
                : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            {UNIT_LABELS[u]}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-body-sm text-fg-muted">Carregando...</p>}

      {!isLoading && (
        <div className="bg-bg-surface rounded-xl border border-border p-4 space-y-3">
          {SECTORS.map(sector => (
            <div key={sector} className="flex items-center gap-3">
              <label className="text-body w-32 shrink-0">{SECTOR_LABELS[sector]}</label>
              <select
                className="flex-1 rounded-lg border border-border bg-bg-surface px-3 py-2 text-body text-fg focus:outline-none focus:border-brand"
                value={draft[sector]}
                onChange={e => setDraft(prev => ({ ...prev, [sector]: e.target.value }))}
              >
                <option value="">Sem responsável fixo</option>
                {collabs.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {feedback && (
        <p className={`text-body-sm ${feedback.startsWith('Erro') ? 'text-danger' : 'text-success'}`}>
          {feedback}
        </p>
      )}

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending || isLoading}
        className="w-full py-3 bg-brand text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {saveMutation.isPending ? 'Salvando...' : `Salvar equipe da ${UNIT_LABELS[unit]}`}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tsc**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Expected: erro `Cannot find module '../screens/ConfigurarEquipe'` quando importado em App.tsx (ainda não wired) — não, não vai aparecer porque ainda não importamos. Sem erros esperados aqui.

---

## Task 6: PWA — Rota + botão "Equipe" no AgendaEscolar

**Files:**
- Modify `D:\la-organizer\_remote\web\src\App.tsx`
- Modify `D:\la-organizer\_remote\web\src\screens\AgendaEscolar.tsx`

- [ ] **Step 1: Adicionar import e rota em `App.tsx`**

Localize o import de `EventoDetalhe`:
```tsx
import { EventoDetalhe } from './screens/EventoDetalhe';
```

ANTES dessa linha, adicione:
```tsx
import { ConfigurarEquipe } from './screens/ConfigurarEquipe';
```

Localize a rota:
```tsx
<Route path="mais/eventos/:id" element={<EventoDetalhe />} />
```

LOGO APÓS, adicione:
```tsx
<Route path="mais/agenda-escolar/equipe" element={<ConfigurarEquipe />} />
```

- [ ] **Step 2: Adicionar botão "Equipe" no header de `AgendaEscolar.tsx`**

Localize o `<header>`:
```tsx
      <header>
        <h2 className="text-title text-fg">Agenda Escolar</h2>
        <p className="text-body-sm text-fg-muted mt-1">Eventos institucionais da escola</p>
      </header>
```

Substitua por:
```tsx
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-title text-fg">Agenda Escolar</h2>
          <p className="text-body-sm text-fg-muted mt-1">Eventos institucionais da escola</p>
        </div>
        <Link
          to="/mais/agenda-escolar/equipe"
          className="text-caption text-brand underline focus-ring rounded whitespace-nowrap"
        >
          Equipe
        </Link>
      </header>
```

(O `Link` já é importado de `react-router-dom` no topo do arquivo — adicionado em Sprint 14 Fatia 1.)

- [ ] **Step 3: Verificar tsc**

```bash
cd D:\la-organizer\_remote\web && npx tsc --noEmit
```

Expected: sem erros.

---

## Task 7: Build + Deploy + Smoke Test E2E

- [ ] **Step 1: Build da PWA**

```bash
cd D:\la-organizer\_remote\web && npm run build
```

Expected: build sem erros. Output em `web/dist/`.

- [ ] **Step 2: Deploy PWA**

```bash
scp -i ~/.ssh/tom_vps -r D:/la-organizer/_remote/web/dist/. tom:/opt/LA-Organizer/web/dist/
```

- [ ] **Step 3: Deploy engine + dispatcher + skill**

```bash
scp -i ~/.ssh/tom_vps D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp -i ~/.ssh/tom_vps D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
scp -i ~/.ssh/tom_vps D:/la-organizer/_remote/skills/eventos-institucionais.md tom:/opt/LA-Organizer/skills/eventos-institucionais.md
```

- [ ] **Step 4: Restart pm2**

```bash
ssh -i ~/.ssh/tom_vps tom "pm2 restart tom && pm2 restart la-organizer-web && pm2 status --no-color | head -20"
```

Expected: ambos `online`.

- [ ] **Step 5: Smoke test SQL — kit gerado de evento de teste**

Use `mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__execute_sql`. Pegar UUIDs:

```sql
SELECT
  (SELECT id FROM collaborators WHERE role = 'coordinator' AND is_active = true LIMIT 1) AS coord_id,
  (SELECT id FROM collaborators WHERE role = 'collaborator' AND is_active = true LIMIT 1) AS collab_id;
```

Anote `<COORD-UUID>` e `<COLLAB-UUID>`.

Configurar 2 setores no mapa para Barra (logística + técnica):
```sql
INSERT INTO event_team_map (unit, sector, collaborator_id) VALUES
  ('barra', 'logistica', '<COLLAB-UUID>'),
  ('barra', 'tecnica',   '<COORD-UUID>')
ON CONFLICT (unit, sector) DO UPDATE SET collaborator_id = EXCLUDED.collaborator_id;
```

Inserir evento de teste manualmente (simulando o que o engine faria) — aqui inserimos direto para testar o schema, não o fluxo TOM:
```sql
INSERT INTO school_events (title, event_date, unit, event_type, created_by, status, notify_leadership, notify_school, notify_unit, notify_day_of)
VALUES ('Teste S14F2 Show', CURRENT_DATE + 7, 'barra', 'show', '<COORD-UUID>', 'active', false, false, false, false)
RETURNING id, title, event_type;
```

Anote `<EVENT-UUID>`. Note que esse INSERT direto **não** dispara o engine — é só para validar o schema. Para validar o fluxo completo, use o Step 7.

- [ ] **Step 6: Cleanup do INSERT manual**

```sql
DELETE FROM tasks WHERE school_event_id = '<EVENT-UUID>';
DELETE FROM school_events WHERE id = '<EVENT-UUID>';
```

- [ ] **Step 7: Smoke test fluxo TOM (manual)**

Abra WhatsApp do coordinator. Envie ao TOM:
```
Cria um show de fim de ano no dia 20/12/2026 às 19h, na unidade Barra, no auditório principal
```

Expected do TOM:
1. Mostra resumo com `✓ Kit de tarefas — 9 tarefas (performance) atribuídas à equipe da Barra` (5ª linha do plano)
2. Pergunta para confirmar
3. Após "sim/confirma", cria o evento

Verificar via SQL:
```sql
SELECT id, title, event_type FROM school_events WHERE title LIKE '%Show de fim de ano%' ORDER BY created_at DESC LIMIT 1;
```

Expected: 1 row com `event_type = 'show'`.

```sql
SELECT t.title, t.event_sector, c.full_name AS responsavel, t.due_date, t.remind_at
FROM tasks t
LEFT JOIN collaborators c ON c.id = t.assigned_to
WHERE t.school_event_id = (SELECT id FROM school_events WHERE title LIKE '%Show de fim de ano%' ORDER BY created_at DESC LIMIT 1)
ORDER BY t.event_sector, t.created_at;
```

Expected:
- 9 rows
- Tasks de logística atribuídas ao `<COLLAB-UUID>` (configurado no mapa)
- Tasks de técnica atribuídas ao `<COORD-UUID>` (configurado no mapa)
- Tasks de pedagogico/comunicacao/producao atribuídas ao criador (`<COORD-UUID>`, fallback)
- Todas com `due_date = 2026-12-20`
- Todas com `remind_at = 2026-12-19T12:00:00Z` (T-1 às 09h BRT)

- [ ] **Step 8: Smoke test PWA — Configurar equipe**

Abra a PWA. Login como coordinator/director. Navegue:
1. `Mais` → `Agenda Escolar`
2. ✅ No header da Agenda Escolar, link "Equipe" aparece
3. Clica em "Equipe" → tela `/mais/agenda-escolar/equipe` carrega
4. Tabs Barra/Recreio/Campo Grande visíveis
5. ✅ Tab "Barra" mostra Logística e Técnica preenchidos (do Step 5)
6. Muda algum select → "Salvar equipe da Barra" → vê "Salvo com sucesso."
7. Recarrega a página → mudanças persistem

- [ ] **Step 9: Smoke test PWA — eventos com kit**

Em `Mais` → `Agenda Escolar`, encontre o evento "Show de fim de ano" criado no Step 7. Clica em "Tarefas do evento" → `/mais/eventos/:id`.

Expected:
- ✅ 5 setores aparecem (Logística com 2 tasks, Técnica com 2, Pedagógico com 2, Comunicação com 2, Produção com 1)
- ✅ Tasks de logística mostram nome do collab cadastrado no mapa
- ✅ Tasks de outros setores mostram nome do criador (coordinator) como fallback

- [ ] **Step 10: Smoke test dispatcher (lembrete T-1)**

Para testar o lembrete sem esperar uma semana, ajustar `remind_at` de uma das tasks para agora:

```sql
-- Pega 1 task do evento de teste e ajusta remind_at para o passado
UPDATE tasks SET remind_at = NOW() - interval '1 minute', reminded_at = NULL
WHERE id = (
  SELECT id FROM tasks
  WHERE school_event_id = (SELECT id FROM school_events WHERE title LIKE '%Show de fim de ano%' ORDER BY created_at DESC LIMIT 1)
  LIMIT 1
)
RETURNING id, title, remind_at;
```

Aguarde o próximo tick do dispatcher (~1 minuto se está rodando em loop). Verifique:

```sql
SELECT id, title, remind_at, reminded_at FROM tasks
WHERE school_event_id = (SELECT id FROM school_events WHERE title LIKE '%Show de fim de ano%' ORDER BY created_at DESC LIMIT 1)
  AND reminded_at IS NOT NULL;
```

Expected: 1 row com `reminded_at` preenchido. O responsável (collaborator_id da task) deve ter recebido WhatsApp `⏰ [Nome], lembrete: *[título da task]* (evento *Show de fim de ano*) é amanhã. Tudo certo da sua parte?`.

- [ ] **Step 11: Cleanup do evento de teste**

```sql
DELETE FROM tasks WHERE school_event_id = (SELECT id FROM school_events WHERE title LIKE '%Show de fim de ano%' AND created_at > NOW() - interval '1 day');
DELETE FROM announcements WHERE source_event_id = (SELECT id FROM school_events WHERE title LIKE '%Show de fim de ano%' AND created_at > NOW() - interval '1 day');
DELETE FROM school_events WHERE title LIKE '%Show de fim de ano%' AND created_at > NOW() - interval '1 day';
```

(Limpa só o evento de teste recente, preserva qualquer evento real com mesmo título.)

---

## Self-Review

**Spec coverage:**
- ✅ Seção 1 DB: `event_type`, `event_team_map`, `reminded_at`, RLS (Task 1)
- ✅ Seção 2 Kits hardcoded em engine.js (Task 2)
- ✅ Seção 3 Engine `applySchoolEventAction` + parser + `buildEventTaskKit` (Task 2)
- ✅ Seção 4 Dispatcher `remindEventTasks` + wire em `run()` (Task 3)
- ✅ Seção 5 TOM Skill `event_type` no marker + resumo (Task 4)
- ✅ Seção 6 PWA `ConfigurarEquipe` + rota + botão (Tasks 5-6)
- ✅ Build + deploy + smoke E2E (Task 7)

**No placeholders.**

**Type consistency:**
- `event_type` valores: `show|recital|workshop|treinamento|oficinas|reuniao|formatura|evento` consistente em DB CHECK, parser, kit lookup
- `family` valores: `performance|aprendizagem|reuniao|formatura|evento` consistente entre `TYPE_TO_FAMILY` e `EVENT_TASK_KITS`
- `sector` valores: `logistica|tecnica|pedagogico|comunicacao|producao` consistente em DB CHECK, kit, mapa, PWA
- `unit` valores: `barra|recreio|campo_grande` consistente em DB CHECK, mapa, PWA
- `source: 'system'` aceita pelo CHECK existente em `tasks` (verificado na exploração)
- `remind_at` calculado como `event_date 12h UTC - 24h` = dia anterior 12h UTC = dia anterior 09h BRT ✓

**Note:** Sem git neste projeto. Artefatos vão direto para a VPS via scp em Task 7.

**Próxima fatia possível (futura):**
- Mapa de equipe por evento (override por evento) — espera demanda real
- Múltiplos lembretes (T-3, T-1) — espera demanda real
- Edição dos kits via interface — só se virar configuração de usuário
