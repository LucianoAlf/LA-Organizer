# Sprint 2 — Timeline do Líder + Briefing Pré-1:1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TOM mantém memória estruturada de cada líder (manager/coordinator/director) e gera briefing automático 30min antes de qualquer reunião 1:1 marcada na agenda.

**Architecture:** Nova tabela `leader_timeline` que captura eventos de governança (1:1 realizada, decisão tomada, bottleneck detectado, milestone). Hooks em `applyEventActions` e `applyTaskActions` alimentam a timeline automaticamente. Job a cada 5min varre eventos do tipo "1:1" nos próximos 35min e dispara `buildLeaderBriefing()` 30min antes.

**Tech Stack:** Node.js, Supabase, supabase-js, node-cron, Claude API. Reusa `governance-analyzer.js` do Sprint 1.

---

## ⚠️ Pré-requisito: coluna `related_to_collaborator_id` em events

A tabela `events` (verificado 27/05/2026) NÃO tem `related_to_collaborator_id`. O watcher de 1:1 precisa dela pra saber QUAL líder a reunião referencia. **Migration adicional** (Task 0 abaixo) cria essa coluna ANTES da Task 3.

---

## Mapa de arquivos

**Criar:**
- `supabase/migrations/20260527125000_events_related_to_collaborator.sql` — coluna nova (PRÉ-requisito)
- `supabase/migrations/20260527130000_leader_timeline.sql` — tabela + índices
- `src/services/leader-timeline.js` — append/query
- `src/services/leader-briefing.js` — geração de briefing pré-reunião
- `skills/briefing-pre-1on1.md` — formato canônico de briefing
- `src/rituals/pre-1on1-watcher.js` — job que dispara briefing

**Modificar:**
- `src/engine.js` — hook em `applyEventActions` (registra 1:1 agendado/realizado) e `applyTaskActions` (registra fechamento/atraso)
- `src/rituals/dispatcher.js` — registrar cron a cada 5min do watcher

---

## Task 0: Mini-migration — adicionar `related_to_collaborator_id` em events

**Files:**
- Create: `supabase/migrations/20260527125000_events_related_to_collaborator.sql`

- [ ] **Step 1: SQL**

```sql
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS related_to_collaborator_id uuid REFERENCES collaborators(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_related_to ON events(related_to_collaborator_id) WHERE related_to_collaborator_id IS NOT NULL;
COMMENT ON COLUMN events.related_to_collaborator_id IS 'Para eventos 1:1 e reuniões focadas em uma pessoa específica — quem é o foco. Diferente de collaborator_id (dono) e created_by (criador).';
```

- [ ] **Step 2: Aplicar via MCP `apply_migration`** + validar com `\d events`.

- [ ] **Step 3: Commit**

---

## Task 1: Migration `leader_timeline`

**Files:**
- Create: `supabase/migrations/20260527130000_leader_timeline.sql`

- [ ] **Step 1: Criar SQL**

```sql
CREATE TABLE IF NOT EXISTS leader_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    '1on1_scheduled','1on1_held','1on1_skipped',
    'decision_made','milestone_reached','bottleneck_detected',
    'commitment_made','commitment_broken','commitment_fulfilled',
    'escalation_recommended','task_closed','task_overdue'
  )),
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual','llm')),
  related_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  related_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leader_timeline_leader ON leader_timeline(leader_id);
CREATE INDEX IF NOT EXISTS idx_leader_timeline_occurred ON leader_timeline(leader_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_leader_timeline_type ON leader_timeline(event_type);

-- RLS: só director e o próprio líder veem seus próprios registros
ALTER TABLE leader_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY leader_timeline_select_owner ON leader_timeline
  FOR SELECT USING (
    leader_id = (SELECT id FROM collaborators WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM collaborators WHERE user_id = auth.uid() AND role = 'director')
  );

CREATE POLICY leader_timeline_insert_service ON leader_timeline
  FOR INSERT WITH CHECK (true);  -- service_role insert sempre
```

- [ ] **Step 2: Aplicar via MCP Supabase `apply_migration`**

- [ ] **Step 3: Validar**

```sql
SELECT count(*) FROM leader_timeline;  -- expected: 0
\d leader_timeline                       -- expected: 7 colunas + RLS habilitado
```

- [ ] **Step 4: Commit**

---

## Task 2: Service `leader-timeline.js`

**Files:**
- Create: `src/services/leader-timeline.js`

- [ ] **Step 1: Implementar append + getRecent + getCommitments**

```javascript
// src/services/leader-timeline.js
// Camada de acesso à tabela leader_timeline. Append-only por padrão.
const supabase = require('../supabase/client');

async function append({ leaderId, eventType, eventData = {}, source = 'auto', relatedEventId = null, relatedTaskId = null, occurredAt = null }) {
  if (!leaderId || !eventType) throw new Error('leaderId and eventType required');
  const row = {
    leader_id: leaderId,
    event_type: eventType,
    event_data: eventData,
    source,
    related_event_id: relatedEventId,
    related_task_id: relatedTaskId,
  };
  if (occurredAt) row.occurred_at = occurredAt;
  const { data, error } = await supabase.from('leader_timeline').insert(row).select('id').single();
  if (error) {
    console.error('[leader_timeline] insert err:', error.message);
    return null;
  }
  return data.id;
}

async function getRecent(leaderId, { limit = 30, sinceDays = 60 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const { data } = await supabase
    .from('leader_timeline')
    .select('id, event_type, event_data, occurred_at, related_task_id, related_event_id')
    .eq('leader_id', leaderId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getLast1on1(leaderId) {
  const { data } = await supabase
    .from('leader_timeline')
    .select('id, event_data, occurred_at')
    .eq('leader_id', leaderId)
    .eq('event_type', '1on1_held')
    .order('occurred_at', { ascending: false })
    .limit(1).maybeSingle();
  return data;
}

async function getOpenCommitments(leaderId) {
  const { data: made } = await supabase
    .from('leader_timeline').select('id, event_data, occurred_at')
    .eq('leader_id', leaderId).eq('event_type', 'commitment_made')
    .order('occurred_at', { ascending: false }).limit(20);
  const { data: closed } = await supabase
    .from('leader_timeline').select('event_data')
    .eq('leader_id', leaderId).in('event_type', ['commitment_fulfilled','commitment_broken'])
    .order('occurred_at', { ascending: false }).limit(40);
  const closedKeys = new Set((closed || []).map(c => c.event_data?.key).filter(Boolean));
  return (made || []).filter(m => !closedKeys.has(m.event_data?.key));
}

module.exports = { append, getRecent, getLast1on1, getOpenCommitments };
```

- [ ] **Step 2: Syntax check + deploy + commit**

---

## Task 3: Hooks no engine

**Files:**
- Modify: `src/engine.js` — funções `applyEventActions`, `applyTaskActions`, `applyCoordinationResponseAction`

- [ ] **Step 1: Hook em `applyEventActions` quando evento é criado e parece 1:1**

Localize `applyEventActions` (linha ~1869). Após o insert bem-sucedido de cada evento, adicione:

```javascript
const isOneOnOne = /1\s*:\s*1|one[\s-]?on[\s-]?one|conversa\s+com|sentar\s+com|alinhamento\s+com/i.test(ev.title || '');
if (isOneOnOne && ev.related_to_collaborator_id) {
  const { append } = require('./services/leader-timeline');
  await append({
    leaderId: ev.related_to_collaborator_id,
    eventType: '1on1_scheduled',
    eventData: { title: ev.title, scheduled_for: ev.event_date, owner_id: collaborator.id },
    relatedEventId: insertedEv.id,
  });
}
```

(Se `events` não tiver `related_to_collaborator_id`, criar via migration adicional ou usar `attendees` array — verificar schema antes.)

- [ ] **Step 2: Hook em `applyTaskActions` quando task fecha ou estoura prazo**

Após `action === 'complete'`:

```javascript
const { append } = require('./services/leader-timeline');
const owner = task.assigned_to;
if (owner) {
  await append({
    leaderId: owner, eventType: 'task_closed',
    eventData: { title: task.title, completed_at: new Date().toISOString() },
    relatedTaskId: task.id,
  });
}
```

Análogo pra `task_overdue` quando o ritual de governança detecta atraso.

- [ ] **Step 3: Syntax check + deploy + commit**

---

## Task 4: Service `leader-briefing.js`

**Files:**
- Create: `src/services/leader-briefing.js`

- [ ] **Step 1: Implementar `buildLeaderBriefing`**

```javascript
// src/services/leader-briefing.js
// Gera briefing pré-1:1 com: pendências, padrões, última 1:1, compromissos abertos.
const supabase = require('../supabase/client');
const timeline = require('./leader-timeline');
const ai = require('../ai/provider');

async function buildLeaderBriefing(leaderId, options = {}) {
  const { data: leader } = await supabase
    .from('collaborators').select('id, full_name, role, function_title')
    .eq('id', leaderId).maybeSingle();
  if (!leader) return null;

  const { data: openTasks } = await supabase
    .from('tasks')
    .select('id, title, due_date, status, coordination_request_count')
    .eq('assigned_to', leaderId)
    .eq('data_classification', 'real')
    .in('status', ['pending','in_progress'])
    .order('due_date', { ascending: true })
    .limit(20);

  const overdue = (openTasks || []).filter(t => t.due_date < new Date().toISOString().slice(0,10));
  const stuckTasks = (openTasks || []).filter(t => (t.coordination_request_count || 0) >= 3);
  const last1on1 = await timeline.getLast1on1(leaderId);
  const openCommitments = await timeline.getOpenCommitments(leaderId);
  const recentEvents = await timeline.getRecent(leaderId, { limit: 15, sinceDays: 30 });

  const sections = [];
  sections.push(`*Briefing pré-1:1 com ${leader.full_name}* — ${leader.function_title || leader.role}`);
  sections.push(`\n*📋 Pendências do time dele:*\n• Abertas: ${(openTasks||[]).length}\n• Atrasadas: ${overdue.length}\n• Com 3+ cobranças sem efeito: ${stuckTasks.length}`);

  if (stuckTasks.length > 0) {
    const top3 = stuckTasks.slice(0, 3).map(t => `  • ${t.title.slice(0, 60)} (cobrado ${t.coordination_request_count}x)`).join('\n');
    sections.push(`\n*⚠️ Travadas (pra confrontar):*\n${top3}`);
  }

  if (openCommitments.length > 0) {
    const top3 = openCommitments.slice(0, 3).map(c => `  • ${c.event_data?.summary || c.event_data?.key} (de ${new Date(c.occurred_at).toLocaleDateString('pt-BR')})`).join('\n');
    sections.push(`\n*🤝 Compromissos abertos da última 1:1:*\n${top3}`);
  }

  if (last1on1) {
    const daysAgo = Math.round((Date.now() - new Date(last1on1.occurred_at).getTime()) / 86400000);
    const summary = last1on1.event_data?.summary || '(sem resumo)';
    sections.push(`\n*🗓️ Última 1:1:* ${daysAgo} dias atrás\n_${summary.slice(0, 200)}_`);
  } else {
    sections.push(`\n*🆕 Primeira 1:1 (sem histórico)*`);
  }

  if (recentEvents.length > 0) {
    const bottlenecks = recentEvents.filter(e => e.event_type === 'bottleneck_detected').slice(0, 3);
    if (bottlenecks.length > 0) {
      sections.push(`\n*🔍 Padrões últimos 30 dias:*\n${bottlenecks.map(b => `  • ${b.event_data?.summary || b.event_data?.pattern}`).join('\n')}`);
    }
  }

  return sections.join('\n');
}

module.exports = { buildLeaderBriefing };
```

- [ ] **Step 2: Syntax check + commit**

---

## Task 5: Watcher de 1:1 (cron 5min)

**Files:**
- Create: `src/rituals/pre-1on1-watcher.js`
- Modify: `src/rituals/dispatcher.js` (registrar no cron)

- [ ] **Step 1: Implementar watcher**

```javascript
// src/rituals/pre-1on1-watcher.js
// Roda a cada 5min. Acha eventos 1:1 que começam em [30min..35min] no futuro
// e dispara briefing pro dono do evento.
const supabase = require('../supabase/client');
const whatsapp = require('../services/whatsapp');
const { buildLeaderBriefing } = require('../services/leader-briefing');

const BRIEFING_KEY_PREFIX = 'pre_1on1_briefing';

async function tick() {
  const now = Date.now();
  const windowStart = new Date(now + 30 * 60000).toISOString();
  const windowEnd   = new Date(now + 35 * 60000).toISOString();

  const { data: upcoming } = await supabase
    .from('events')
    .select('id, title, event_date, owner_collaborator_id, related_to_collaborator_id, collaborators!events_owner_collaborator_id_fkey(id, full_name, phone)')
    .gte('event_date', windowStart)
    .lt('event_date', windowEnd)
    .eq('data_classification', 'real');

  if (!upcoming || upcoming.length === 0) return;

  for (const ev of upcoming) {
    const isOneOnOne = /1\s*:\s*1|one[\s-]?on[\s-]?one|conversa\s+com|sentar\s+com|alinhamento\s+com/i.test(ev.title || '');
    if (!isOneOnOne) continue;
    if (!ev.related_to_collaborator_id) continue;

    const idempotencyKey = `${BRIEFING_KEY_PREFIX}_${ev.id}`;
    const { data: existing } = await supabase
      .from('ritual_logs').select('id').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing) continue;

    try {
      const briefing = await buildLeaderBriefing(ev.related_to_collaborator_id);
      if (!briefing) continue;
      const owner = ev.collaborators;
      if (!owner?.phone) continue;
      await whatsapp.sendMessage(owner.phone, briefing);
      await supabase.from('ritual_logs').insert({
        collaborator_id: owner.id, ritual_type: 'pre_1on1_briefing',
        status: 'sent', idempotency_key: idempotencyKey,
        notes: `event=${ev.id} leader=${ev.related_to_collaborator_id}`,
      });
      console.log(`[Pre1on1] briefing sent for event ${ev.id}`);
    } catch (err) {
      console.error(`[Pre1on1] err for event ${ev.id}:`, err.message);
    }
  }
}

module.exports = { tick };
```

- [ ] **Step 2: Registrar cron em dispatcher.js**

Localizar onde outros `cron.schedule(...)` aparecem. Adicionar:

```javascript
const pre1on1 = require('./pre-1on1-watcher');
cron.schedule('*/5 * * * *', () => {
  pre1on1.tick().catch(err => console.error('[Pre1on1] tick err:', err.message));
}, { timezone: 'America/Sao_Paulo' });
```

- [ ] **Step 3: Syntax check + deploy**

```bash
cd /d/la-organizer/_remote && node --check src/rituals/pre-1on1-watcher.js && node --check src/rituals/dispatcher.js && scp src/services/leader-timeline.js src/services/leader-briefing.js src/rituals/pre-1on1-watcher.js src/rituals/dispatcher.js src/engine.js tom:/opt/LA-Organizer/src/ && ssh tom "pm2 restart tom"
```

(Ajustar paths — pode precisar `scp -r` ou múltiplos `scp`.)

- [ ] **Step 4: Commit**

---

## Task 6: Skill `briefing-pre-1on1.md`

**Files:**
- Create: `skills/briefing-pre-1on1.md`

- [ ] **Step 1: Documentar formato canônico**

```markdown
# Briefing Pré-1:1

Ativa quando TOM detecta que evento 1:1 começa em 30min e dispara `buildLeaderBriefing`.

## Quando ativar

- Evento com título contendo "1:1", "one-on-one", "conversa com", "sentar com", "alinhamento com" — AND `related_to_collaborator_id` definido.
- Disparo automático via `src/rituals/pre-1on1-watcher.js` (cron 5min).

## Formato canônico

Use o formato exato gerado por `buildLeaderBriefing()`. Seções na ordem:
1. Header: `*Briefing pré-1:1 com {nome}* — {função}`
2. Pendências numéricas (abertas/atrasadas/com 3+ cobranças)
3. Travadas (top 3 com 3+ cobranças)
4. Compromissos abertos da última 1:1 (top 3)
5. Última 1:1 (resumo + dias atrás)
6. Padrões detectados últimos 30 dias

## NÃO fazer

- Não pedir informação que já está no briefing pronto.
- Não chamar LLM no briefing — texto é determinístico, gerado em `leader-briefing.js`.
- Não enviar 2x pro mesmo evento (idempotência via `ritual_logs.idempotency_key`).
```

- [ ] **Step 2: Commit**

---

## Task 7: Validação manual

- [ ] **Step 1: Criar evento 1:1 daqui a 32min**

Via WhatsApp pro TOM:
"Tom, marca 1:1 com Quintela amanhã 15h" → garantir que TOM emite EVENT_CREATE com title contendo "1:1" e `related_to_collaborator_id = quintela.id`.

(Pra teste imediato: edit direto no banco com `event_date = now() + 32min`.)

- [ ] **Step 2: Aguardar 5min (cron tick)**

- [ ] **Step 3: Verificar mensagem recebida**

Alf deve receber WhatsApp com briefing formatado.

- [ ] **Step 4: Verificar idempotência**

```sql
SELECT * FROM ritual_logs WHERE idempotency_key LIKE 'pre_1on1_briefing_%';
```

Expected: 1 linha. No próximo tick (5min depois), watcher NÃO deve enviar de novo.

---

## Critério de pronto

- Tabela `leader_timeline` populando automaticamente via hooks no engine.
- Evento 1:1 marcado → briefing chega 30min antes.
- Briefing tem pelo menos: pendências numéricas + última 1:1 + compromissos abertos.
- Idempotência via `ritual_logs` impede envio duplicado.
