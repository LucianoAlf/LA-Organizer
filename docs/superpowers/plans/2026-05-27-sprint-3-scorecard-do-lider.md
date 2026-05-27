# Sprint 3 — Scorecard do Líder (Loop de Desenvolvimento)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda segunda-feira, gerar scorecard semanal de cada líder (manager/coordinator) — uma versão privada pro Alf (consolidada todos os líderes) e uma versão adaptada pro próprio líder. Mostra evolução entre semanas pra Alf usar em 1:1 e líder usar pra desenvolver liderados.

**Architecture:** Nova tabela `leader_scorecards` com snapshot semanal (closure_rate, atrasadas, escaladas sem efeito, bottlenecks dominantes, delta vs semana anterior). Ritual em `dispatcher.js` roda segunda 8h BRT pro Alf e 9h BRT pra cada líder. Dados vêm de `tasks`, `events`, `leader_timeline` (Sprint 2). Templates em `skills/scorecard-semanal.md`.

**Tech Stack:** Node.js, Supabase, node-cron, Claude API (geração de "insight da semana" via LLM com prompt restrito).

---

## Mapa de arquivos

**Criar:**
- `supabase/migrations/20260527140000_leader_scorecards.sql` — tabela
- `src/services/scorecard-builder.js` — computa métricas + persist + render
- `src/rituals/monday-scorecard.js` — ritual semanal
- `skills/scorecard-semanal.md` — formato canônico das 2 versões

**Modificar:**
- `src/rituals/dispatcher.js` — registrar cron segunda 8h e 9h

---

## Task 1: Migration `leader_scorecards`

**Files:**
- Create: `supabase/migrations/20260527140000_leader_scorecards.sql`

- [ ] **Step 1: SQL**

```sql
CREATE TABLE IF NOT EXISTS leader_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  closure_rate numeric NOT NULL DEFAULT 0,        -- 0.0-1.0
  tasks_closed int NOT NULL DEFAULT 0,
  tasks_overdue int NOT NULL DEFAULT 0,
  tasks_stuck int NOT NULL DEFAULT 0,             -- 3+ cobranças sem efeito
  top_bottlenecks jsonb NOT NULL DEFAULT '[]'::jsonb,
  insights text,                                   -- gerado pelo LLM (1 frase)
  delta_vs_prev jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_to_director boolean NOT NULL DEFAULT false,
  sent_to_leader boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (leader_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_leader_scorecards_leader ON leader_scorecards(leader_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_leader_scorecards_week ON leader_scorecards(week_start);

ALTER TABLE leader_scorecards ENABLE ROW LEVEL SECURITY;
CREATE POLICY scorecard_select_owner ON leader_scorecards
  FOR SELECT USING (
    leader_id = (SELECT id FROM collaborators WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM collaborators WHERE user_id = auth.uid() AND role = 'director')
  );
```

- [ ] **Step 2: Aplicar via MCP `apply_migration`**

- [ ] **Step 3: Validar com `\d leader_scorecards`**

- [ ] **Step 4: Commit**

---

## Task 2: Service `scorecard-builder.js`

**Files:**
- Create: `src/services/scorecard-builder.js`

- [ ] **Step 1: Implementar `computeScorecard` + `persistScorecard` + `renderForDirector` + `renderForLeader`**

```javascript
// src/services/scorecard-builder.js
// Computa métricas semanais por líder, persiste em leader_scorecards,
// e renderiza 2 versões (director e leader).
const supabase = require('../supabase/client');
const ai = require('../ai/provider');

// Retorna { weekStart: 'YYYY-MM-DD', weekEnd: 'YYYY-MM-DD' } pra semana ANTERIOR
function lastWeekRange(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay() - 6);  // domingo anterior - 6 = segunda anterior
  const start = d.toISOString().slice(0,10);
  const e = new Date(d);
  e.setUTCDate(e.getUTCDate() + 6);
  const end = e.toISOString().slice(0,10);
  return { weekStart: start, weekEnd: end };
}

async function computeScorecard(leaderId, weekStart, weekEnd) {
  const { data: closed } = await supabase
    .from('tasks').select('id, title, category')
    .eq('assigned_to', leaderId).eq('status', 'done')
    .gte('completed_at', weekStart + 'T00:00:00-03:00')
    .lt('completed_at', weekEnd + 'T23:59:59-03:00');

  const { data: open } = await supabase
    .from('tasks').select('id, title, due_date, category, coordination_request_count, status')
    .eq('assigned_to', leaderId).eq('data_classification', 'real')
    .in('status', ['pending','in_progress']);

  const today = new Date(weekEnd + 'T23:59:59-03:00').toISOString().slice(0,10);
  const overdue = (open || []).filter(t => t.due_date < today);
  const stuck = (open || []).filter(t => (t.coordination_request_count || 0) >= 3);

  const totalForRate = (closed?.length || 0) + overdue.length;
  const closure_rate = totalForRate === 0 ? 1.0 : (closed?.length || 0) / totalForRate;

  const categoryCounts = {};
  for (const t of (overdue || []).concat(stuck)) {
    const c = t.category || 'sem_categoria';
    categoryCounts[c] = (categoryCounts[c] || 0) + 1;
  }
  const top_bottlenecks = Object.entries(categoryCounts)
    .sort((a,b) => b[1] - a[1]).slice(0, 3)
    .map(([cat, count]) => ({ category: cat, count }));

  return {
    tasks_closed: closed?.length || 0,
    tasks_overdue: overdue.length,
    tasks_stuck: stuck.length,
    closure_rate: Math.round(closure_rate * 100) / 100,
    top_bottlenecks,
  };
}

async function computeDelta(leaderId, weekStart, currentMetrics) {
  const prevStart = new Date(weekStart + 'T00:00:00Z');
  prevStart.setUTCDate(prevStart.getUTCDate() - 7);
  const prevWeekStart = prevStart.toISOString().slice(0,10);

  const { data: prev } = await supabase
    .from('leader_scorecards').select('closure_rate, tasks_closed, tasks_overdue, tasks_stuck')
    .eq('leader_id', leaderId).eq('week_start', prevWeekStart).maybeSingle();
  if (!prev) return { is_first_week: true };

  return {
    closure_rate_delta: Math.round((currentMetrics.closure_rate - prev.closure_rate) * 100) / 100,
    closed_delta: currentMetrics.tasks_closed - prev.tasks_closed,
    overdue_delta: currentMetrics.tasks_overdue - prev.tasks_overdue,
    stuck_delta: currentMetrics.tasks_stuck - prev.tasks_stuck,
  };
}

async function generateInsight(leader, metrics, delta) {
  const sys = `Você é analista de operações. Gere UMA frase (max 18 palavras) que resume o desempenho semanal do líder e a tendência. Sem floreio. Sem emoji. Sem aspas.`;
  const userMsg = `Líder: ${leader.full_name}
Closure rate: ${Math.round(metrics.closure_rate*100)}% (delta vs semana anterior: ${delta.closure_rate_delta != null ? (delta.closure_rate_delta>0?'+':'')+Math.round(delta.closure_rate_delta*100)+'pp' : 'primeira semana'})
Fechou: ${metrics.tasks_closed} | Atrasadas: ${metrics.tasks_overdue} (delta ${delta.overdue_delta ?? 'N/A'}) | Travadas 3+: ${metrics.tasks_stuck}
Bottleneck principal: ${metrics.top_bottlenecks[0]?.category || 'nenhum claro'}`;
  try {
    const r = await ai.chat(sys, [{ role: 'user', content: userMsg }]);
    return String(r?.text || r?.reply || '').trim().slice(0, 200);
  } catch (e) {
    return 'Semana concluída sem análise (IA indisponível).';
  }
}

async function persistScorecard(leaderId, weekStart, weekEnd, metrics, delta, insights) {
  const { data, error } = await supabase
    .from('leader_scorecards')
    .upsert({
      leader_id: leaderId, week_start: weekStart, week_end: weekEnd,
      closure_rate: metrics.closure_rate, tasks_closed: metrics.tasks_closed,
      tasks_overdue: metrics.tasks_overdue, tasks_stuck: metrics.tasks_stuck,
      top_bottlenecks: metrics.top_bottlenecks, insights,
      delta_vs_prev: delta, generated_at: new Date().toISOString(),
    }, { onConflict: 'leader_id,week_start' })
    .select('id').single();
  if (error) { console.error('[scorecard] upsert err:', error.message); return null; }
  return data.id;
}

function renderForDirector(scorecards, leadersById) {
  if (!scorecards || scorecards.length === 0) return null;
  const lines = ['📊 *Scorecard semanal — seus líderes*\n'];
  for (const sc of scorecards.sort((a,b) => b.closure_rate - a.closure_rate)) {
    const leader = leadersById.get(sc.leader_id);
    if (!leader) continue;
    const pct = Math.round(sc.closure_rate * 100);
    const deltaTxt = sc.delta_vs_prev.closure_rate_delta != null
      ? ` (${sc.delta_vs_prev.closure_rate_delta >= 0 ? '+' : ''}${Math.round(sc.delta_vs_prev.closure_rate_delta * 100)}pp)`
      : ' (1ª semana)';
    const arrow = sc.delta_vs_prev.closure_rate_delta > 0 ? '↑' : sc.delta_vs_prev.closure_rate_delta < 0 ? '↓' : '→';
    lines.push(`*${leader.full_name}* ${arrow} ${pct}%${deltaTxt}`);
    lines.push(`  ✅ fechou ${sc.tasks_closed} | ⚠️ ${sc.tasks_overdue} atrasadas | 🔒 ${sc.tasks_stuck} travadas 3+`);
    if (sc.insights) lines.push(`  _${sc.insights}_`);
    if (sc.top_bottlenecks?.[0]) lines.push(`  🎯 bottleneck: *${sc.top_bottlenecks[0].category}* (${sc.top_bottlenecks[0].count})`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function renderForLeader(scorecard, leader) {
  const pct = Math.round(scorecard.closure_rate * 100);
  const lines = [`📊 *Sua semana, ${leader.full_name.split(' ')[0]}*\n`];
  lines.push(`✅ Fechou ${scorecard.tasks_closed} tarefas (${pct}% de fechamento)`);
  if (scorecard.tasks_overdue > 0) lines.push(`⚠️ ${scorecard.tasks_overdue} ficaram atrasadas`);
  if (scorecard.tasks_stuck > 0) lines.push(`🔒 ${scorecard.tasks_stuck} travadas com 3+ cobranças — vamos destravar?`);
  if (scorecard.top_bottlenecks?.[0]) {
    lines.push(`\nPadrão da semana: *${scorecard.top_bottlenecks[0].category}* concentrou ${scorecard.top_bottlenecks[0].count} pendências.`);
  }
  if (scorecard.delta_vs_prev?.closure_rate_delta != null) {
    const d = scorecard.delta_vs_prev.closure_rate_delta;
    if (d >= 0.1) lines.push(`\n🏆 Bora, semana melhor que a anterior (+${Math.round(d*100)}pp).`);
    else if (d <= -0.1) lines.push(`\n👀 Semana ficou ${Math.round(d*100)}pp abaixo da anterior — me chama se quiser destravar algo.`);
  }
  lines.push(`\n_Quer puxar isso no time? Te ajudo a montar a conversa._`);
  return lines.join('\n');
}

module.exports = { computeScorecard, computeDelta, generateInsight, persistScorecard, renderForDirector, renderForLeader, lastWeekRange };
```

- [ ] **Step 2: Syntax check + commit**

---

## Task 3: Ritual `monday-scorecard.js`

**Files:**
- Create: `src/rituals/monday-scorecard.js`
- Modify: `src/rituals/dispatcher.js` (registrar cron)

- [ ] **Step 1: Implementar ritual**

```javascript
// src/rituals/monday-scorecard.js
// Segunda 8h BRT: gera scorecards de todos os líderes + envia consolidado pro director.
// Segunda 9h BRT: envia versão individual pra cada líder.
const supabase = require('../supabase/client');
const whatsapp = require('../services/whatsapp');
const builder = require('../services/scorecard-builder');

async function isCoordOrAbove(c) {
  return c.role === 'coordinator' || c.role === 'manager' || c.role === 'director' || c.has_coord_permissions === true;
}

async function generateAllScorecards() {
  const { weekStart, weekEnd } = builder.lastWeekRange();
  const { data: leaders } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, has_coord_permissions, function_title')
    .eq('is_active', true).not('phone', 'is', null);
  const eligible = (leaders || []).filter(isCoordOrAbove).filter(c => c.role !== 'director');

  const scorecards = [];
  for (const leader of eligible) {
    const metrics = await builder.computeScorecard(leader.id, weekStart, weekEnd);
    const delta = await builder.computeDelta(leader.id, weekStart, metrics);
    const insights = await builder.generateInsight(leader, metrics, delta);
    const id = await builder.persistScorecard(leader.id, weekStart, weekEnd, metrics, delta, insights);
    if (id) scorecards.push({ id, leader, metrics, delta, insights, week_start: weekStart, week_end: weekEnd });
  }
  return scorecards;
}

async function sendToDirector() {
  const todayDow = new Date().getDay();
  if (todayDow !== 1) return;  // só segunda

  const { data: directors } = await supabase
    .from('collaborators').select('id, full_name, phone').eq('role','director').not('phone','is',null);
  if (!directors || directors.length === 0) return;

  const scorecards = await generateAllScorecards();
  const leadersById = new Map(scorecards.map(s => [s.leader.id, s.leader]));
  const scRows = scorecards.map(s => ({
    leader_id: s.leader.id,
    closure_rate: s.metrics.closure_rate,
    tasks_closed: s.metrics.tasks_closed,
    tasks_overdue: s.metrics.tasks_overdue,
    tasks_stuck: s.metrics.tasks_stuck,
    top_bottlenecks: s.metrics.top_bottlenecks,
    insights: s.insights,
    delta_vs_prev: s.delta,
    week_start: s.week_start,
  }));

  const msg = builder.renderForDirector(scRows, leadersById);
  if (!msg) return;

  for (const dir of directors) {
    try {
      await whatsapp.sendMessage(dir.phone, msg);
      await supabase.from('leader_scorecards').update({ sent_to_director: true })
        .in('id', scorecards.map(s => s.id));
      console.log(`[Scorecard] sent to director ${dir.full_name}`);
    } catch (err) {
      console.error(`[Scorecard] director send err: ${err.message}`);
    }
  }
}

async function sendToEachLeader() {
  const todayDow = new Date().getDay();
  if (todayDow !== 1) return;

  const { weekStart } = builder.lastWeekRange();
  const { data: scs } = await supabase
    .from('leader_scorecards')
    .select('*, collaborators!leader_scorecards_leader_id_fkey(id, full_name, phone)')
    .eq('week_start', weekStart).eq('sent_to_leader', false);
  for (const sc of scs || []) {
    const leader = sc.collaborators;
    if (!leader?.phone) continue;
    try {
      const msg = builder.renderForLeader(sc, leader);
      await whatsapp.sendMessage(leader.phone, msg);
      await supabase.from('leader_scorecards').update({ sent_to_leader: true }).eq('id', sc.id);
      console.log(`[Scorecard] sent to leader ${leader.full_name}`);
    } catch (err) {
      console.error(`[Scorecard] leader send err (${leader.full_name}): ${err.message}`);
    }
  }
}

module.exports = { sendToDirector, sendToEachLeader, generateAllScorecards };
```

- [ ] **Step 2: Registrar cron**

Em `src/rituals/dispatcher.js`:

```javascript
const mondayScorecard = require('./monday-scorecard');

// Segunda 8h BRT — director
cron.schedule('0 8 * * 1', () => {
  mondayScorecard.sendToDirector().catch(err => console.error('[Scorecard director] err:', err.message));
}, { timezone: 'America/Sao_Paulo' });

// Segunda 9h BRT — leaders
cron.schedule('0 9 * * 1', () => {
  mondayScorecard.sendToEachLeader().catch(err => console.error('[Scorecard leaders] err:', err.message));
}, { timezone: 'America/Sao_Paulo' });
```

- [ ] **Step 3: Syntax check + deploy + commit**

---

## Task 4: Skill `scorecard-semanal.md`

**Files:**
- Create: `skills/scorecard-semanal.md`

- [ ] **Step 1: Documentar formato**

```markdown
# Scorecard Semanal

Geração automática segunda 8h (director) e 9h (líder). NÃO emitir markers — mensagem é gerada server-side por `scorecard-builder.js`.

## Quando ativar (skill carrega contexto pra TOM responder DEPOIS)

- Quando user (director ou líder) pergunta sobre o scorecard recebido: "Tom, me explica esse scorecard", "qual o pior bottleneck?", "como o Quintela tá comparado ao mês passado?"

## Como TOM responde

- Buscar `leader_scorecards` ordenado por `week_start DESC` limitado por contexto.
- Usar campos `closure_rate`, `top_bottlenecks`, `insights`, `delta_vs_prev`.
- NÃO inventar números. Se campo é null/ausente, dizer "sem dado nessa métrica".

## Formato canônico — versão director

(Texto gerado por `renderForDirector` — TOM apenas amplifica/explica quando questionado.)

## Formato canônico — versão líder

(Texto gerado por `renderForLeader` — pessoal, encorajador, com convite à ação.)

## NÃO fazer

- Não emitir scorecard manualmente via marker — sistema é determinístico.
- Não comparar líder com líder em conversa com o líder (só consolidado vai pro director).
- Não revelar números de outros líderes pra um líder.
```

- [ ] **Step 2: Commit**

---

## Task 5: Validação end-to-end

- [ ] **Step 1: Forçar execução manual fora de segunda**

Via SSH:
```bash
ssh tom 'cd /opt/LA-Organizer && set -a; . ./.env; set +a; node -e "
const m = require(\"./src/rituals/monday-scorecard\");
(async () => { await m.sendToDirector(); await m.sendToEachLeader(); process.exit(0); })();
"'
```

(Remover o gate `todayDow !== 1` temporariamente OU criar variant de teste.)

- [ ] **Step 2: Verificar tabela populada**

```sql
SELECT leader_id, week_start, closure_rate, tasks_closed, tasks_overdue, insights
FROM leader_scorecards ORDER BY generated_at DESC LIMIT 10;
```

- [ ] **Step 3: Verificar mensagens recebidas**

Alf deve receber consolidado. Cada líder com atividade na semana deve receber versão dele.

- [ ] **Step 4: Validar delta na semana seguinte**

Após 2ª execução, verificar `delta_vs_prev` populado com valores reais (não `is_first_week`).

---

## Critério de pronto

- Segunda 8h BRT: Alf recebe 1 mensagem consolidada com scorecard de cada líder elegível.
- Segunda 9h BRT: cada líder elegível recebe sua versão privada.
- Tabela `leader_scorecards` tem 1 linha por (leader_id, week_start).
- Delta vs semana anterior aparece em mensagens a partir da 2ª semana.
- Líder NÃO vê dados de outros líderes na sua versão.
