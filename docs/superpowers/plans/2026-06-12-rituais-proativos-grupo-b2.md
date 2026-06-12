# B2 — Rituais proativos + Notificações do grupo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o TOM enviar relatórios do grupo automaticamente (bom dia diário, semanal, mensal, cobrança de atrasadas) em horários configuráveis por grupo, com uma tela de Notificações onde qualquer membro liga/desliga e ajusta dia/horário.

**Architecture:** Um cron (`dispatchGroupReports`) roda no tick já existente do `dispatcher.js`, casa cada preset habilitado com a hora atual (fuso SP), garante idempotência via claim atômico em `group_ritual_logs` e insere um card `kind='report' channel='app'` em `group_chat_messages` — que o bridge-out já espelha pro WhatsApp e o app já renderiza. O conteúdo reaproveita 100% o `buildGroupReport` da B1 (estendido com `heading` + `onlyOverdue`). A config mora em `group_notification_settings` (RLS = membro do grupo) e é editada por uma seção nova no `GroupConfigPanel`.

**Tech Stack:** Node CJS (`src/`), Supabase Postgres (project `cesnbnrynvxvgdhfmaua`), React+TS+Tailwind PWA (`web/`), `node --test` (backend puro), vitest (PWA puro).

---

## Convenções deste projeto (ler antes de começar)

- **Fuso:** Brasil é `-03:00` fixo (sem horário de verão). NUNCA usar `toISOString().slice(0,10)` para data local. Datas YMD vêm de helpers que formatam em `America/Sao_Paulo`.
- **Deploy backend:** `scp D:/la-organizer/_remote/<arquivo> tom:/opt/LA-Organizer/<arquivo>` + `ssh tom "pm2 restart tom"`. Valida sintaxe com `node --check`.
- **Deploy PWA:** só editar em `_remote/web/`; o Stop hook commita e pusha (Vercel deploya). Validar com `cd _remote/web && npx tsc --noEmit && npx vite build`.
- **Migrations:** aplicar via MCP Supabase `apply_migration` (project `cesnbnrynvxvgdhfmaua`).
- **DS obrigatório:** `<CustomSelect>`, `<TimeInput>`, `<Field>`, `<Button>`; tokens `bg-bg-surface`/`bg-bg-elevated`/`text-fg`/`text-tom`/`border-border`. Cor **`tom`** (verde), nunca `brand`.
- **Testes backend:** arquivos `*.test.js` ao lado do código, rodam com `node --test src/<path>/<file>.test.js`.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| migration `b2_group_notifications` | 2 tabelas + RLS + índices | Criar (MCP) |
| `src/services/group-report-builder.js` | builder B1 + `heading`/`onlyOverdue` | Modificar |
| `src/services/group-report-builder.test.js` | testes do builder | Modificar |
| `src/rituals/group-reports.js` | puras `matchSchedule`/`presetConfig` + `claimGroupRitual` + `dispatchGroupReports` | Criar |
| `src/rituals/group-reports.test.js` | testes das puras | Criar |
| `src/rituals/dispatcher.js` | 1 chamada no tick | Modificar |
| `scripts/force-group-report.js` | gatilho e2e na VPS | Criar |
| `web/src/lib/groupNotifications.ts` | PRESETS + defaults + validação + I/O | Criar |
| `web/src/lib/groupNotifications.test.ts` | testes das puras | Criar |
| `web/src/screens/grupos/config/GroupNotificationsSection.tsx` | tela acordeão | Criar |
| `web/src/screens/grupos/GroupConfigPanel.tsx` | render da seção | Modificar |

---

## Task 1: Migration — tabelas + RLS

**Files:**
- Create (via MCP `apply_migration`, project `cesnbnrynvxvgdhfmaua`, name `b2_group_notifications`)

- [ ] **Step 1: Aplicar a migration**

Usar a tool MCP `apply_migration` com este SQL exato. O padrão de RLS de membro foi copiado verbatim das policies de `group_chat_messages` (`current_collab_id()` + `work_group_members`):

```sql
-- group_notification_settings: config por (grupo, preset)
create table if not exists public.group_notification_settings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.work_groups(id) on delete cascade,
  preset text not null check (preset in ('daily_morning','weekly','monthly','overdue')),
  enabled boolean not null default true,
  weekdays int[] not null default '{}',           -- 1=seg .. 7=dom
  day_of_month int check (day_of_month between 1 and 28),
  time_local text not null default '08:00',        -- 'HH:MM' fuso SP
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, preset)
);

alter table public.group_notification_settings enable row level security;

create policy gns_member_select on public.group_notification_settings
  for select using (
    group_id in (select group_id from public.work_group_members
                 where collaborator_id = current_collab_id())
  );
create policy gns_member_insert on public.group_notification_settings
  for insert with check (
    group_id in (select group_id from public.work_group_members
                 where collaborator_id = current_collab_id())
  );
create policy gns_member_update on public.group_notification_settings
  for update using (
    group_id in (select group_id from public.work_group_members
                 where collaborator_id = current_collab_id())
  ) with check (
    group_id in (select group_id from public.work_group_members
                 where collaborator_id = current_collab_id())
  );
create policy gns_member_delete on public.group_notification_settings
  for delete using (
    group_id in (select group_id from public.work_group_members
                 where collaborator_id = current_collab_id())
  );
create policy gns_service_all on public.group_notification_settings
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- group_ritual_logs: idempotência do cron (claim atômico)
create table if not exists public.group_ritual_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.work_groups(id) on delete cascade,
  preset text not null,
  reference_date date not null,
  sent_at timestamptz not null default now(),
  unique (group_id, preset, reference_date)
);

alter table public.group_ritual_logs enable row level security;
-- sem policy de usuário (deny-all p/ anon/authenticated); acesso só via service_role:
create policy grl_service_all on public.group_ritual_logs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
```

- [ ] **Step 2: Verificar que as tabelas existem e o RLS está ligado**

Rodar via MCP `execute_sql`:

```sql
select tablename, rowsecurity from pg_tables
where tablename in ('group_notification_settings','group_ritual_logs');
```
Expected: 2 linhas, `rowsecurity = true` em ambas.

```sql
select policyname, cmd from pg_policies
where tablename in ('group_notification_settings','group_ritual_logs') order by 1;
```
Expected: 5 policies em `group_notification_settings` (gns_member_select/insert/update/delete + gns_service_all) e 1 em `group_ritual_logs` (grl_service_all).

- [ ] **Step 3: Confirmar o claim atômico (insert duplicado falha com 23505)**

```sql
-- grupo Financeiro
insert into public.group_ritual_logs (group_id, preset, reference_date)
values ('d95f63af-5032-4120-89f2-ca4c49684cbc','daily_morning','2000-01-01');
insert into public.group_ritual_logs (group_id, preset, reference_date)
values ('d95f63af-5032-4120-89f2-ca4c49684cbc','daily_morning','2000-01-01');
```
Expected: o 2º insert falha com `duplicate key value violates unique constraint`. Depois limpar:
```sql
delete from public.group_ritual_logs where reference_date = '2000-01-01';
```

---

## Task 2: Estender `group-report-builder.js` (heading + onlyOverdue)

**Files:**
- Modify: `src/services/group-report-builder.js`
- Test: `src/services/group-report-builder.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `src/services/group-report-builder.test.js` (antes de qualquer `// fim`), usando um supabase fake como os testes já existentes do arquivo (se o arquivo ainda não tiver um fake, este bloco traz um). Os testes cobrem: (a) `heading` custom aparece no card; (b) `onlyOverdue` lista só atrasadas e `isEmpty=false`; (c) `onlyOverdue` sem atrasadas → `isEmpty=true`.

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildGroupReport } = require('./group-report-builder');

// supabase fake: tasks fixas + work_groups.name
function fakeSupabase(tasks) {
  return {
    from(tbl) {
      const chain = {
        _tbl: tbl,
        select() { return chain; },
        eq() { return chain; },
        neq() { return chain; },
        order() { return Promise.resolve({ data: tasks }); },
        maybeSingle() { return Promise.resolve({ data: { name: 'Financeiro' } }); },
      };
      return chain;
    },
  };
}

test('buildGroupReport: heading custom sobrescreve o título padrão', async () => {
  const sb = fakeSupabase([]);
  const { html } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'agenda', window: 'hoje',
    heading: '☀️ Bom dia, Financeiro! Hoje vocês têm:', now: new Date('2026-06-15T12:00:00-03:00'),
  });
  assert.ok(html.includes('☀️ Bom dia, Financeiro! Hoje vocês têm:'));
  assert.ok(!html.includes('📊 Relatório do'));
});

test('buildGroupReport: onlyOverdue lista só atrasadas e isEmpty=false', async () => {
  const sb = fakeSupabase([
    { title: 'Conciliar cartões', due_date: '2026-06-01', status: 'pending', creator: { preferred_name: 'Rose' } },
    { title: 'Tarefa futura', due_date: '2026-12-31', status: 'pending', creator: { preferred_name: 'Alf' } },
  ]);
  const { html, isEmpty } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'tarefas', onlyOverdue: true,
    heading: '⏰ Financeiro: tarefas atrasadas', now: new Date('2026-06-15T12:00:00-03:00'),
  });
  assert.strictEqual(isEmpty, false);
  assert.ok(html.includes('Conciliar cartões'));
  assert.ok(!html.includes('Tarefa futura'));
});

test('buildGroupReport: onlyOverdue sem atrasadas → isEmpty=true', async () => {
  const sb = fakeSupabase([
    { title: 'Tarefa futura', due_date: '2026-12-31', status: 'pending', creator: { preferred_name: 'Alf' } },
  ]);
  const { isEmpty } = await buildGroupReport({
    supabase: sb, groupId: 'g1', scope: 'tarefas', onlyOverdue: true, now: new Date('2026-06-15T12:00:00-03:00'),
  });
  assert.strictEqual(isEmpty, true);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd D:/la-organizer/_remote && node --test src/services/group-report-builder.test.js`
Expected: FAIL — os 3 novos testes quebram (`heading` ignorado, `isEmpty` undefined, `onlyOverdue` não filtra).

- [ ] **Step 3: Implementar no builder**

Em `src/services/group-report-builder.js`:

(a) `renderReportHtml` aceita `heading` opcional:
```js
function renderReportHtml({ groupName, windowLabel, sections, heading }) {
  const blocks = (sections || []).map((s) => {
    const body = (s.items && s.items.length)
      ? `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : `<p>(nada no período)</p>`;
    return `<h3>${s.emoji} ${esc(s.title)}</h3>${body}`;
  }).join('');
  const title = heading ? esc(heading) : `📊 Relatório do ${esc(groupName)} — ${esc(windowLabel)}`;
  return `<div><h3>${title}</h3>${blocks}</div>`;
}
```

(b) `buildGroupReport` ganha `heading` e `onlyOverdue` e retorna `isEmpty`. Trocar a assinatura e o miolo:
```js
async function buildGroupReport({ supabase, groupId, scope = 'tudo', window = 'mes', now = new Date(), heading = null, onlyOverdue = false }) {
  const bounds = windowBounds(window, now);
  const todayYmd = spYmd(now);
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  const groupName = g?.name || 'grupo';

  let tasks = [];
  try { tasks = await queryGroupTasks(supabase, groupId); } catch (e) { console.error('[Report] tasks err:', e.message); }

  // Modo cobrança de atrasadas: só tarefas com due_date < hoje.
  if (onlyOverdue) {
    const overdue = (tasks || [])
      .filter((t) => t.due_date && t.due_date < todayYmd)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const sections = [{ emoji: '⏰', title: 'Tarefas atrasadas', items: overdue.map((t) => taskLine(t, todayYmd)) }];
    const html = renderReportHtml({ groupName, windowLabel: bounds.label, sections, heading });
    return { html, isEmpty: overdue.length === 0 };
  }

  const { comPrazo, semPrazo } = splitTasks(tasks);
  const startYmd = bounds.start.slice(0, 10);
  const endYmd = bounds.end.slice(0, 10);
  const agenda = comPrazo.filter((t) => t.due_date >= startYmd && t.due_date <= endYmd);

  const sections = [];
  if (scope === 'agenda' || scope === 'tudo') {
    sections.push({ emoji: '📅', title: `Agenda (${bounds.label})`, items: agenda.map((t) => taskLine(t, todayYmd)) });
  }
  if (scope === 'tarefas') {
    sections.push({ emoji: '✅', title: 'Tarefas com prazo', items: comPrazo.map((t) => taskLine(t, todayYmd)) });
  }
  if (scope === 'tarefas' || scope === 'tudo') {
    sections.push({ emoji: '🗓️', title: 'Tarefas sem prazo', items: semPrazo.map((t) => taskLine(t, todayYmd)) });
  }
  const want = (s) => scope === 'tudo' || scope === s;
  if (want('anotacoes')) {
    let notes = [];
    try { notes = await queryGroupNotes(supabase, groupId); } catch (e) { console.error('[Report] notes err:', e.message); }
    if (notes.length) sections.push({ emoji: '📝', title: 'Anotações', items: notes });
  }
  if (want('checklists')) {
    let cl = [];
    try { cl = await queryGroupChecklists(supabase, groupId); } catch (e) { console.error('[Report] checklists err:', e.message); }
    if (cl.length) sections.push({ emoji: '☑️', title: 'Checklists', items: cl });
  }
  if (!sections.length) sections.push({ emoji: '🎉', title: 'Tudo limpo', items: [] });
  const itemCount = sections.reduce((n, s) => n + (s.items ? s.items.length : 0), 0);
  return { html: renderReportHtml({ groupName, windowLabel: bounds.label, sections, heading }), isEmpty: itemCount === 0 };
}
```

> Compatibilidade B1: callers antigos passam só `{supabase, groupId, scope, window}` e usam `.html` — `heading`/`onlyOverdue` têm default e `isEmpty` é campo extra ignorado. Sem quebra.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote && node --test src/services/group-report-builder.test.js`
Expected: PASS (todos, inclusive os 3 novos e os antigos da B1).

- [ ] **Step 5: Deploy do builder**

```bash
scp D:/la-organizer/_remote/src/services/group-report-builder.js tom:/opt/LA-Organizer/src/services/group-report-builder.js
ssh tom "pm2 restart tom"
```

---

## Task 3: Funções puras `group-reports.js` (matchSchedule + presetConfig + claim)

**Files:**
- Create: `src/rituals/group-reports.js`
- Test: `src/rituals/group-reports.test.js`

- [ ] **Step 1: Escrever os testes que falham**

`src/rituals/group-reports.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { matchSchedule, presetConfig, PRESETS } = require('./group-reports');

// now = { hour, minute, dow (0=dom..6=sab), ymd }
const seg08 = { hour: 8, minute: 2, dow: 1, ymd: '2026-06-15' }; // segunda 08:02 → slot 08:00

test('matchSchedule: daily_morning casa weekday + slot', () => {
  const s = { preset: 'daily_morning', weekdays: [1,2,3,4,5], time_local: '08:00' };
  assert.strictEqual(matchSchedule(seg08, s), true);
  assert.strictEqual(matchSchedule({ ...seg08, dow: 6 }, s), false); // sábado fora
  assert.strictEqual(matchSchedule({ ...seg08, hour: 9 }, s), false); // hora errada
});

test('matchSchedule: weekly usa weekdays de 1 elemento', () => {
  const s = { preset: 'weekly', weekdays: [1], time_local: '08:00' };
  assert.strictEqual(matchSchedule(seg08, s), true);
  assert.strictEqual(matchSchedule({ ...seg08, dow: 2 }, s), false);
});

test('matchSchedule: domingo (dow=0) vira ISO 7', () => {
  const s = { preset: 'weekly', weekdays: [7], time_local: '08:00' };
  assert.strictEqual(matchSchedule({ hour: 8, minute: 0, dow: 0, ymd: '2026-06-14' }, s), true);
});

test('matchSchedule: monthly casa day_of_month + slot', () => {
  const s = { preset: 'monthly', day_of_month: 15, time_local: '08:00' };
  assert.strictEqual(matchSchedule(seg08, s), true);
  assert.strictEqual(matchSchedule({ ...seg08, ymd: '2026-06-16' }, s), false);
});

test('presetConfig: mapeia os 4 presets', () => {
  assert.deepStrictEqual(presetConfig('daily_morning'), { scope: 'agenda', window: 'hoje', onlyOverdue: false, headingTemplate: '☀️ Bom dia, {grupo}! Hoje vocês têm:' });
  assert.strictEqual(presetConfig('weekly').window, 'semana');
  assert.strictEqual(presetConfig('monthly').window, 'mes');
  assert.strictEqual(presetConfig('overdue').onlyOverdue, true);
});

test('PRESETS na ordem da tela', () => {
  assert.deepStrictEqual(PRESETS, ['daily_morning','weekly','monthly','overdue']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd D:/la-organizer/_remote && node --test src/rituals/group-reports.test.js`
Expected: FAIL — `Cannot find module './group-reports'`.

- [ ] **Step 3: Implementar as puras**

`src/rituals/group-reports.js` (só as puras + helpers por enquanto; a orquestradora vem na Task 4):

```js
// src/rituals/group-reports.js
// B2 — Rituais proativos do grupo. dispatchGroupReports roda no tick do dispatcher,
// casa cada preset habilitado com a hora atual (fuso SP), claim atômico em
// group_ritual_logs (idempotência), e insere card kind='report' em group_chat_messages
// (bridge-out espelha pro WhatsApp; app renderiza). Conteúdo = buildGroupReport (B1).
'use strict';

const PRESETS = ['daily_morning', 'weekly', 'monthly', 'overdue'];

const PRESET_CONFIG = {
  daily_morning: { scope: 'agenda', window: 'hoje', onlyOverdue: false, headingTemplate: '☀️ Bom dia, {grupo}! Hoje vocês têm:' },
  weekly:        { scope: 'tudo',   window: 'semana', onlyOverdue: false, headingTemplate: '📅 Semana do {grupo}' },
  monthly:       { scope: 'tudo',   window: 'mes',  onlyOverdue: false, headingTemplate: '🗓️ Mês do {grupo}' },
  overdue:       { scope: 'tarefas', window: 'mes', onlyOverdue: true,  headingTemplate: '⏰ {grupo}: tarefas atrasadas' },
};

function presetConfig(preset) { return PRESET_CONFIG[preset]; }

// 'HH:MM' → minutos do dia, arredondado ao slot de 15min (espelha dispatcher.timeToSlot).
function timeToSlot(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + Math.floor(m / 15) * 15;
}
function currentSlot(now) { return now.hour * 60 + Math.floor(now.minute / 15) * 15; }

// dow do nowSaoPaulo é 0=dom..6=sab; weekdays usa ISO 1=seg..7=dom.
function isoDow(now) { return now.dow === 0 ? 7 : now.dow; }

// Casa um setting com o instante atual (now = nowSaoPaulo()).
function matchSchedule(now, setting) {
  if (currentSlot(now) !== timeToSlot(setting.time_local)) return false;
  if (setting.preset === 'monthly') {
    return Number(now.ymd.slice(8, 10)) === Number(setting.day_of_month);
  }
  return Array.isArray(setting.weekdays) && setting.weekdays.includes(isoDow(now));
}

module.exports = { PRESETS, presetConfig, matchSchedule, timeToSlot, currentSlot, isoDow };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote && node --test src/rituals/group-reports.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit lógico (sem deploy ainda — orquestradora vem na Task 4)**

Nada a fazer no servidor; só seguir. (O auto-deploy commita ao fim do turno.)

---

## Task 4: Orquestradora `dispatchGroupReports` + claim + integração no dispatcher

**Files:**
- Modify: `src/rituals/group-reports.js` (adicionar claim + orquestradora)
- Modify: `src/rituals/dispatcher.js` (1 chamada no tick)
- Create: `scripts/force-group-report.js`

- [ ] **Step 1: Adicionar `claimGroupRitual` + `dispatchGroupReports` ao módulo**

Em `src/rituals/group-reports.js`, antes do `module.exports`, adicionar:

```js
// Claim atômico: insert em group_ritual_logs. 23505 = já disparou hoje → skip.
async function claimGroupRitual(supabase, groupId, preset, ymd) {
  const { data, error } = await supabase
    .from('group_ritual_logs')
    .insert({ group_id: groupId, preset, reference_date: ymd })
    .select('id')
    .single();
  if (error) return { won: false, duplicate: error.code === '23505', code: error.code || null };
  return { won: true, id: data.id };
}

// Orquestradora chamada no tick do dispatcher.
// deps: { buildGroupReport } (injetável p/ teste). now = nowSaoPaulo().
async function dispatchGroupReports({ now, supabase, deps }) {
  const buildGroupReport = deps && deps.buildGroupReport
    ? deps.buildGroupReport
    : require('../services/group-report-builder').buildGroupReport;
  const ymd = now.ymd;

  const { data: settings, error } = await supabase
    .from('group_notification_settings')
    .select('group_id, preset, enabled, weekdays, day_of_month, time_local, group:work_groups!group_notification_settings_group_id_fkey(name)')
    .eq('enabled', true);
  if (error) { console.error('[GroupReports] query settings:', error.message); return; }
  if (!settings || !settings.length) return;

  for (const s of settings) {
    if (!matchSchedule(now, s)) continue;
    const cfg = presetConfig(s.preset);
    if (!cfg) continue;
    const groupName = s.group ? s.group.name : 'grupo';
    const heading = cfg.headingTemplate.replace('{grupo}', groupName);
    try {
      if (cfg.onlyOverdue) {
        // overdue: checa atrasadas ANTES; só claima/envia se houver.
        const { html, isEmpty } = await buildGroupReport({
          supabase, groupId: s.group_id, scope: cfg.scope, window: cfg.window,
          onlyOverdue: true, heading, now: new Date(),
        });
        if (isEmpty) { console.log(`[GroupReports] ${groupName}/overdue: sem atrasadas, skip`); continue; }
        const claim = await claimGroupRitual(supabase, s.group_id, s.preset, ymd);
        if (!claim.won) { if (!claim.duplicate) console.error(`[GroupReports] claim_err ${groupName}/overdue ${claim.code}`); continue; }
        await insertReportCard(supabase, s.group_id, html);
        console.log(`[GroupReports] sent ${groupName}/overdue`);
      } else {
        // demais: claim ANTES (sempre enviam), evita corrida entre ticks.
        const claim = await claimGroupRitual(supabase, s.group_id, s.preset, ymd);
        if (!claim.won) { if (!claim.duplicate) console.error(`[GroupReports] claim_err ${groupName}/${s.preset} ${claim.code}`); continue; }
        const { html } = await buildGroupReport({
          supabase, groupId: s.group_id, scope: cfg.scope, window: cfg.window, heading, now: new Date(),
        });
        await insertReportCard(supabase, s.group_id, html);
        console.log(`[GroupReports] sent ${groupName}/${s.preset}`);
      }
    } catch (err) {
      console.error(`[GroupReports] err ${groupName}/${s.preset}:`, err.message);
    }
  }
}

// Insere o card kind='report' (mesma forma do card da B1/closing). channel='app'
// faz o bridge-out espelhar pro WhatsApp; o app renderiza via realtime.
async function insertReportCard(supabase, groupId, html) {
  const { error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId, sender_id: null, role: 'tom', kind: 'report', content: html, channel: 'app',
  });
  if (error) throw new Error('insert card: ' + error.message);
}
```

E atualizar o `module.exports`:
```js
module.exports = { PRESETS, presetConfig, matchSchedule, timeToSlot, currentSlot, isoDow, claimGroupRitual, dispatchGroupReports, insertReportCard };
```

- [ ] **Step 2: Teste da orquestradora (supabase fake + builder fake)**

Adicionar a `src/rituals/group-reports.test.js`:

```js
const { dispatchGroupReports } = require('./group-reports');

// fake supabase que captura o insert do card e simula o claim
function fakeDb({ settings, claimFails = false }) {
  const inserted = [];
  const claims = [];
  const db = {
    inserted, claims,
    from(tbl) {
      if (tbl === 'group_notification_settings') {
        return { select() { return { eq() { return Promise.resolve({ data: settings }); } }; } };
      }
      if (tbl === 'group_ritual_logs') {
        return { insert(row) { claims.push(row); return { select() { return { single() {
          return claimFails ? Promise.resolve({ error: { code: '23505' } }) : Promise.resolve({ data: { id: 'c1' } });
        } }; } }; } };
      }
      if (tbl === 'group_chat_messages') {
        return { insert(row) { inserted.push(row); return Promise.resolve({ error: null }); } };
      }
      return { select() { return { eq() { return Promise.resolve({ data: [] }); } } }; };
    },
  };
  return db;
}

test('dispatchGroupReports: dispara daily_morning no slot e insere card', async () => {
  const now = { hour: 8, minute: 0, dow: 1, ymd: '2026-06-15' };
  const db = fakeDb({ settings: [
    { group_id: 'g1', preset: 'daily_morning', enabled: true, weekdays: [1,2,3,4,5], day_of_month: null, time_local: '08:00', group: { name: 'Financeiro' } },
  ] });
  await dispatchGroupReports({ now, supabase: db, deps: { buildGroupReport: async () => ({ html: '<div>card</div>', isEmpty: false }) } });
  assert.strictEqual(db.inserted.length, 1);
  assert.strictEqual(db.inserted[0].kind, 'report');
  assert.strictEqual(db.inserted[0].channel, 'app');
  assert.strictEqual(db.inserted[0].role, 'tom');
});

test('dispatchGroupReports: overdue vazio não claima nem insere', async () => {
  const now = { hour: 9, minute: 0, dow: 1, ymd: '2026-06-15' };
  const db = fakeDb({ settings: [
    { group_id: 'g1', preset: 'overdue', enabled: true, weekdays: [1], day_of_month: null, time_local: '09:00', group: { name: 'Financeiro' } },
  ] });
  await dispatchGroupReports({ now, supabase: db, deps: { buildGroupReport: async () => ({ html: '', isEmpty: true }) } });
  assert.strictEqual(db.inserted.length, 0);
  assert.strictEqual(db.claims.length, 0);
});

test('dispatchGroupReports: fora do slot não faz nada', async () => {
  const now = { hour: 10, minute: 0, dow: 1, ymd: '2026-06-15' };
  const db = fakeDb({ settings: [
    { group_id: 'g1', preset: 'daily_morning', enabled: true, weekdays: [1], day_of_month: null, time_local: '08:00', group: { name: 'Financeiro' } },
  ] });
  await dispatchGroupReports({ now, supabase: db, deps: { buildGroupReport: async () => ({ html: '<div>x</div>', isEmpty: false }) } });
  assert.strictEqual(db.inserted.length, 0);
});
```

> Nota de teste: o fake de `group_notification_settings.select().eq()` ignora o argumento e devolve `settings` — suficiente porque a orquestradora filtra por `matchSchedule` em memória.

- [ ] **Step 3: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote && node --test src/rituals/group-reports.test.js`
Expected: PASS (todos os testes da Task 3 + os 3 novos).

- [ ] **Step 4: Plugar no tick do dispatcher**

Em `src/rituals/dispatcher.js`, no topo (junto aos outros `require` de rituais):
```js
const { dispatchGroupReports } = require('./group-reports');
```
E no corpo do tick (onde `remindGroupTasks(now)` e os outros checks são chamados — procurar a sequência de `await remind...`/`await check...` dentro da função `run`/`tick`), adicionar:
```js
try { await dispatchGroupReports({ now: nowSaoPaulo(), supabase }); }
catch (e) { console.error('[tick] dispatchGroupReports:', e.message); }
```

> Achar o ponto exato: procurar `remindGroupTasks(` no arquivo e colar a chamada logo depois (ambos são crons de grupo, mesma vizinhança). `nowSaoPaulo` e `supabase` já estão no escopo do dispatcher.

- [ ] **Step 5: Validar sintaxe**

Run: `cd D:/la-organizer/_remote && node --check src/rituals/group-reports.js && node --check src/rituals/dispatcher.js`
Expected: sem saída (exit 0).

- [ ] **Step 6: Script de gatilho e2e**

`scripts/force-group-report.js`:
```js
// VPS: node --env-file=.env scripts/force-group-report.js [preset]
// Força um disparo IGNORANDO o horário (mas respeitando claim diário). Default: daily_morning.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const supabase = require('../src/supabase/client');
const { presetConfig, claimGroupRitual, insertReportCard } = require('../src/rituals/group-reports');
const { buildGroupReport } = require('../src/services/group-report-builder');

const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc'; // Financeiro
const preset = process.argv[2] || 'daily_morning';

(async () => {
  const cfg = presetConfig(preset);
  if (!cfg) { console.error('preset inválido:', preset); process.exit(1); }
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', GID).maybeSingle();
  const groupName = g?.name || 'grupo';
  const heading = cfg.headingTemplate.replace('{grupo}', groupName);
  const { html, isEmpty } = await buildGroupReport({ supabase, groupId: GID, scope: cfg.scope, window: cfg.window, onlyOverdue: cfg.onlyOverdue, heading });
  console.log('isEmpty:', isEmpty);
  if (cfg.onlyOverdue && isEmpty) { console.log('overdue vazio — nada a enviar'); return; }
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const claim = await claimGroupRitual(supabase, GID, preset, ymd);
  if (!claim.won) { console.log('claim não venceu (já enviado hoje?):', claim); return; }
  await insertReportCard(supabase, GID, html);
  console.log('card inserido p/', preset, '→ ver chat + WhatsApp');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 7: Deploy backend**

```bash
scp D:/la-organizer/_remote/src/rituals/group-reports.js tom:/opt/LA-Organizer/src/rituals/group-reports.js
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
scp D:/la-organizer/_remote/scripts/force-group-report.js tom:/opt/LA-Organizer/scripts/force-group-report.js
ssh tom "pm2 restart tom"
```

---

## Task 5: PWA — `groupNotifications.ts` (puras + I/O)

**Files:**
- Create: `web/src/lib/groupNotifications.ts`
- Test: `web/src/lib/groupNotifications.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

`web/src/lib/groupNotifications.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PRESETS, defaultSetting, validateSetting } from './groupNotifications';

describe('groupNotifications', () => {
  it('PRESETS na ordem da tela', () => {
    expect(PRESETS.map(p => p.preset)).toEqual(['daily_morning', 'weekly', 'monthly', 'overdue']);
  });

  it('defaultSetting traz fallback por preset', () => {
    expect(defaultSetting('daily_morning')).toMatchObject({ enabled: true, weekdays: [1,2,3,4,5], time_local: '08:00' });
    expect(defaultSetting('weekly')).toMatchObject({ weekdays: [1], time_local: '08:00' });
    expect(defaultSetting('monthly')).toMatchObject({ day_of_month: 1, time_local: '08:00' });
    expect(defaultSetting('overdue')).toMatchObject({ weekdays: [1,2,3,4,5], time_local: '09:00' });
  });

  it('validateSetting normaliza weekdays (únicos, ordenados) e clampa day_of_month', () => {
    const s = validateSetting({ preset: 'daily_morning', enabled: true, weekdays: [5,1,1,3], day_of_month: 99, time_local: '8:00' });
    expect(s.weekdays).toEqual([1,3,5]);
    expect(s.day_of_month).toBeLessThanOrEqual(28);
    expect(s.time_local).toBe('08:00');
  });

  it('validateSetting: weekly mantém só 1 weekday', () => {
    const s = validateSetting({ preset: 'weekly', enabled: true, weekdays: [3,5], day_of_month: null, time_local: '08:00' });
    expect(s.weekdays).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd D:/la-organizer/_remote/web && npx vitest run src/lib/groupNotifications.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`web/src/lib/groupNotifications.ts`:
```ts
import { supabase } from './supabaseClient';

export type Preset = 'daily_morning' | 'weekly' | 'monthly' | 'overdue';

export interface GroupNotificationSetting {
  preset: Preset;
  enabled: boolean;
  weekdays: number[];        // 1=seg .. 7=dom
  day_of_month: number | null;
  time_local: string;        // 'HH:MM'
}

export interface PresetMeta {
  preset: Preset;
  emoji: string;
  label: string;
  desc: string;
  schedule: 'weekdays' | 'single_weekday' | 'day_of_month';
}

export const PRESETS: PresetMeta[] = [
  { preset: 'daily_morning', emoji: '☀️', label: 'Bom dia diário', desc: '"Hoje o grupo tem…"', schedule: 'weekdays' },
  { preset: 'weekly', emoji: '📅', label: 'Resumo semanal', desc: 'Panorama da semana', schedule: 'single_weekday' },
  { preset: 'monthly', emoji: '🗓️', label: 'Resumo mensal', desc: 'Panorama do mês', schedule: 'day_of_month' },
  { preset: 'overdue', emoji: '⏰', label: 'Cobrança de atrasadas', desc: 'Só quando há tarefa vencida', schedule: 'weekdays' },
];

const DEFAULTS: Record<Preset, GroupNotificationSetting> = {
  daily_morning: { preset: 'daily_morning', enabled: true, weekdays: [1,2,3,4,5], day_of_month: null, time_local: '08:00' },
  weekly:        { preset: 'weekly', enabled: true, weekdays: [1], day_of_month: null, time_local: '08:00' },
  monthly:       { preset: 'monthly', enabled: true, weekdays: [], day_of_month: 1, time_local: '08:00' },
  overdue:       { preset: 'overdue', enabled: true, weekdays: [1,2,3,4,5], day_of_month: null, time_local: '09:00' },
};

export function defaultSetting(preset: Preset): GroupNotificationSetting {
  return { ...DEFAULTS[preset] };
}

function normTime(t: string): string {
  const [h, m] = String(t || '08:00').split(':');
  const hh = String(Math.min(23, Math.max(0, Number(h) || 0))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(m) || 0))).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function validateSetting(s: GroupNotificationSetting): GroupNotificationSetting {
  let weekdays = Array.from(new Set((s.weekdays || []).filter(d => d >= 1 && d <= 7))).sort((a, b) => a - b);
  if (s.preset === 'weekly' && weekdays.length > 1) weekdays = [weekdays[0]];
  let day_of_month = s.day_of_month;
  if (day_of_month != null) day_of_month = Math.min(28, Math.max(1, day_of_month));
  return { ...s, weekdays, day_of_month, time_local: normTime(s.time_local) };
}

// I/O — RLS garante que só membros leem/editam.
export async function loadGroupNotifications(groupId: string): Promise<GroupNotificationSetting[]> {
  const { data, error } = await supabase
    .from('group_notification_settings')
    .select('preset, enabled, weekdays, day_of_month, time_local')
    .eq('group_id', groupId);
  if (error) throw error;
  return (data ?? []) as GroupNotificationSetting[];
}

export async function upsertGroupNotification(groupId: string, s: GroupNotificationSetting): Promise<void> {
  const v = validateSetting(s);
  const { error } = await supabase
    .from('group_notification_settings')
    .upsert({ group_id: groupId, ...v, updated_at: new Date().toISOString() }, { onConflict: 'group_id,preset' });
  if (error) throw error;
}
```

> Confirmar o nome real do client do PWA (`./supabaseClient` exportando `supabase`). Se o projeto usar outro caminho (ex.: `../lib/supabase`), ajustar o import — checar como `web/src/lib/groupChat.ts` (da B1/chat) importa o client e copiar o mesmo.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote/web && npx vitest run src/lib/groupNotifications.test.ts`
Expected: PASS (4 testes).

---

## Task 6: PWA — `GroupNotificationsSection.tsx` + integração

**Files:**
- Create: `web/src/screens/grupos/config/GroupNotificationsSection.tsx`
- Modify: `web/src/screens/grupos/GroupConfigPanel.tsx`

- [ ] **Step 1: Criar o componente (acordeão, auto-save)**

`web/src/screens/grupos/config/GroupNotificationsSection.tsx`:
```tsx
// Seção 🔔 Notificações dentro do GroupConfigPanel. Acordeão: preset desligado = só
// título + toggle; ligado = revela dia(s) + horário. Qualquer membro edita (RLS garante).
// Auto-save com debounce — sem botão Salvar.
import { useEffect, useRef, useState } from 'react';
import { CustomSelect } from '../../../components/CustomSelect';
import { TimeInput } from '../../../components/TimeInput';
import { showToast } from '../../../components/Toast';
import {
  PRESETS, defaultSetting, validateSetting,
  loadGroupNotifications, upsertGroupNotification,
  type GroupNotificationSetting, type Preset,
} from '../../../lib/groupNotifications';

const WD = [
  { v: 1, l: 'S' }, { v: 2, l: 'T' }, { v: 3, l: 'Q' }, { v: 4, l: 'Q' },
  { v: 5, l: 'S' }, { v: 6, l: 'S' }, { v: 7, l: 'D' },
];
const DOM_OPTS = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` }));

export function GroupNotificationsSection({ groupId }: { groupId: string }) {
  const [byPreset, setByPreset] = useState<Record<Preset, GroupNotificationSetting>>(() => ({
    daily_morning: { ...defaultSetting('daily_morning'), enabled: false },
    weekly: { ...defaultSetting('weekly'), enabled: false },
    monthly: { ...defaultSetting('monthly'), enabled: false },
    overdue: { ...defaultSetting('overdue'), enabled: false },
  }));
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    loadGroupNotifications(groupId).then(rows => {
      setByPreset(prev => {
        const next = { ...prev };
        for (const r of rows) next[r.preset] = { ...next[r.preset], ...r };
        return next;
      });
    }).catch(() => showToast({ kind: 'error', title: 'Não consegui carregar as notificações' }));
  }, [groupId]);

  function save(preset: Preset, patch: Partial<GroupNotificationSetting>) {
    setByPreset(prev => {
      const merged = validateSetting({ ...prev[preset], ...patch, preset });
      const next = { ...prev, [preset]: merged };
      clearTimeout(timers.current[preset]);
      timers.current[preset] = setTimeout(() => {
        upsertGroupNotification(groupId, merged)
          .catch(() => showToast({ kind: 'error', title: 'Não consegui salvar' }));
      }, 600);
      return next;
    });
  }

  return (
    <div className="space-y-sm">
      <h3 className="text-body font-semibold text-fg">🔔 Notificações</h3>
      <p className="text-body-sm text-fg-muted">O TOM avisa o grupo automaticamente.</p>

      {PRESETS.map(meta => {
        const s = byPreset[meta.preset];
        return (
          <div key={meta.preset} className="rounded-md border border-border bg-bg-surface p-sm">
            <div className="flex items-center gap-sm">
              <span className="text-lg" aria-hidden>{meta.emoji}</span>
              <span className="flex-1 text-body-sm font-medium text-fg">{meta.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={s.enabled}
                aria-label={`${s.enabled ? 'Desligar' : 'Ligar'} ${meta.label}`}
                onClick={() => save(meta.preset, { enabled: !s.enabled })}
                className={`relative h-5 w-9 rounded-full transition-colors ${s.enabled ? 'bg-tom' : 'bg-bg-elevated'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${s.enabled ? 'right-0.5' : 'left-0.5'}`} />
              </button>
            </div>

            {s.enabled && (
              <div className="mt-sm space-y-sm pl-7">
                {meta.schedule !== 'day_of_month' && (
                  <div className="flex items-center gap-sm">
                    <span className="w-14 text-body-sm text-fg-muted">{meta.schedule === 'single_weekday' ? 'Dia' : 'Dias'}</span>
                    <div className="flex gap-xs">
                      {WD.map(d => {
                        const sel = s.weekdays.includes(d.v);
                        return (
                          <button
                            key={d.v}
                            type="button"
                            aria-pressed={sel}
                            onClick={() => {
                              const next = meta.schedule === 'single_weekday'
                                ? [d.v]
                                : sel ? s.weekdays.filter(x => x !== d.v) : [...s.weekdays, d.v];
                              save(meta.preset, { weekdays: next });
                            }}
                            className={`flex h-6 w-6 items-center justify-center rounded text-body-sm ${
                              sel ? 'bg-tom/15 text-tom border border-tom' : 'bg-bg-elevated text-fg-muted border border-border'
                            }`}
                          >{d.l}</button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {meta.schedule === 'day_of_month' && (
                  <div className="flex items-center gap-sm">
                    <span className="w-14 text-body-sm text-fg-muted">Dia</span>
                    <CustomSelect
                      value={String(s.day_of_month ?? 1)}
                      options={DOM_OPTS}
                      onChange={(v) => save(meta.preset, { day_of_month: Number(v) })}
                      size="sm"
                    />
                  </div>
                )}

                <div className="flex items-center gap-sm">
                  <span className="w-14 text-body-sm text-fg-muted">Horário</span>
                  <TimeInput value={s.time_local} onChange={(v) => save(meta.preset, { time_local: v })} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

> Confirmar a API real de `CustomSelect` (`value/options/onChange/size`) e `TimeInput` (`value/onChange`) abrindo os dois arquivos em `web/src/components/`. Ajustar props se diferirem (ex.: `onChange` recebe evento vs string). Os tokens (`bg-bg-surface`, `text-tom`, `border-border`, `space-y-sm`, `text-body-sm`) já são usados no `GroupConfigPanel`.

- [ ] **Step 2: Renderizar a seção no `GroupConfigPanel`**

Em `web/src/screens/grupos/GroupConfigPanel.tsx`:
- Import no topo:
```tsx
import { GroupNotificationsSection } from './config/GroupNotificationsSection';
```
- Dentro do `<BottomSheet>`, ao fim do bloco `<div className="space-y-md">` (depois da lista de membros e antes do fechamento), adicionar:
```tsx
          <div className="border-t border-border pt-md">
            <GroupNotificationsSection groupId={group.id} />
          </div>
```

> A seção NÃO é gated por `podeEditar` — qualquer membro do grupo edita (decisão do brainstorm; RLS garante no banco). Se o `GroupConfigPanel` inteiro hoje só abre pra líder/diretor, isso é aceitável no v1 (membros comuns ainda veem o card no chat). Não alterar a regra de acesso do painel nesta task.

- [ ] **Step 3: Validar tipos + build**

Run: `cd D:/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Expected: sem erros de tipo; build conclui.

- [ ] **Step 4: Validar no preview (localhost:4173)**

Usar `mcp__Claude_Preview__preview_eval` + `preview_screenshot` (ver [[feedback_preview_validation]]): abrir um grupo → ⚙ Configurações → conferir a seção 🔔 Notificações; ligar "Bom dia diário", marcar dias, mudar horário; recarregar e confirmar que persistiu. Limpar caches do SW no navigate.

---

## Task 7: Validação e2e na VPS + registro

**Files:**
- (sem código novo)

- [ ] **Step 1: Ligar um preset no grupo Financeiro pela tela**

No preview/produção, abrir o grupo Financeiro, ligar "Bom dia diário" (seg–sex, 08:00). Confirmar a linha no banco via MCP `execute_sql`:
```sql
select preset, enabled, weekdays, day_of_month, time_local
from group_notification_settings
where group_id = 'd95f63af-5032-4120-89f2-ca4c49684cbc' order by preset;
```
Expected: linha `daily_morning, enabled=true, weekdays={1,2,3,4,5}, time_local=08:00`.

- [ ] **Step 2: Forçar o disparo e conferir o espelho**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/force-group-report.js daily_morning"
```
Expected: log `card inserido p/ daily_morning`. Conferir: (a) card aparece no chat do grupo no app; (b) espelhado no WhatsApp do grupo Financeiro com hierarquia (emoji + linhas), não texto corrido.

- [ ] **Step 3: Conferir idempotência**

Rodar o mesmo comando de novo:
```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/force-group-report.js daily_morning"
```
Expected: log `claim não venceu (já enviado hoje?)` e NENHUM card novo (claim do dia já existe).

- [ ] **Step 4: Testar overdue (com e sem atrasadas)**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/force-group-report.js overdue"
```
Expected: se houver tarefa do Financeiro com `due_date < hoje` → card "⏰ Financeiro: tarefas atrasadas"; senão → log `overdue vazio — nada a enviar` e nenhum card.

- [ ] **Step 5: Registrar known issue + memória**

Via MCP `execute_sql` (project `cesnbnrynvxvgdhfmaua`), INSERT em `tom_known_issues`:
```sql
insert into tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
values ('GROUPCHAT-B2-RITUAIS-PROATIVOS', 'Rituais proativos do grupo (cron) + tela de Notificações',
   'dispatcher', 'baixo', 'corrigido',
   'Feature nova: o TOM não enviava relatórios de grupo sozinho (só sob demanda na B1).',
   'dispatchGroupReports no tick do dispatcher; 4 presets configuráveis (group_notification_settings); claim atômico group_ritual_logs; reusa buildGroupReport (heading/onlyOverdue); card kind=report espelha via bridge-out.',
   'manual', 'cron de grupo não dispara / dispara 2x / horário errado',
   ARRAY['Financeiro'], now(), now(), 1, now());
```
Atualizar a memória `project_groupchat_b1_relatorios.md` (marcar B2 entregue) e adicionar a linha no `MEMORY.md`.

- [ ] **Step 6: Fechar**

Confirmar com o Alf no grupo Financeiro (print do card proativo). B2 concluída.

---

## Self-Review (preenchido pelo autor do plano)

**1. Spec coverage:**
- §2 decisões (4 presets, controle total, sempre-dispara-exceto-overdue, qualquer-membro, acordeão) → Tasks 1/4/6 ✅
- §3 presets/mapeamento → `presetConfig` (Task 3) + `buildGroupReport` heading/onlyOverdue (Task 2) ✅
- §5 dados (2 tabelas + RLS membro + claim) → Task 1 ✅
- §6 backend (builder, group-reports, dispatcher) → Tasks 2/3/4 ✅
- §7 PWA (lib + section acordeão + integração) → Tasks 5/6 ✅
- §8 testes (puras backend/PWA + e2e VPS) → Tasks 2/3/4/5/7 ✅
- §9 fora de escopo respeitado (sem presets custom, sem quiet, scope/window fixos) ✅

**2. Placeholder scan:** Sem TBD/TODO. As 3 notas `> Confirmar...` (nome do client PWA, API de CustomSelect/TimeInput, ponto exato no dispatcher) são verificações de fidelidade ao código existente, com instrução concreta de como resolver — não são lacunas de design.

**3. Type consistency:** `GroupNotificationSetting` (preset/enabled/weekdays/day_of_month/time_local) é o mesmo do banco (Task 1), do lib (Task 5) e do componente (Task 6). `presetConfig` retorna `{scope, window, onlyOverdue, headingTemplate}` usado igual na orquestradora e no force script. `buildGroupReport` retorna `{html, isEmpty}` consumido igual em Task 4 e no script. `matchSchedule(now, setting)` com `now={hour,minute,dow,ymd}` consistente entre teste e dispatcher.
