# Precisão da cobrança de vencidas (grupo) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (ou subagent-driven-development). Steps usam checkbox (`- [ ]`).

**Goal:** Parar o relatório das 07h de acusar cronicamente tarefas de GRUPO como "sem cobrança" e fechar o buraco de cobertura (MKT mudo + grupo novo sem config), sem regredir o chaser individual nem o builder de grupo.

**Architecture:** 4 peças isoladas — (A) auditor `checkOverdueTasks` mede só tarefas com dono; (B) check novo `uncovered_groups` reusa `queryGroupTasks` (fonte única, done-twin/retroativa já filtrados) p/ vigiar grupo descoberto; (C1) backfill do preset `overdue` no MKT; (C2) trigger que faz grupo novo nascer coberto.

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase (MCP), deploy do engine via `scp` + `pm2 restart` (git fica com o auto-deploy hook).

## Global Constraints

- PT-BR em toda comunicação/log de usuário.
- Testes: `node --test <arquivo>` (node:test nativo).
- Deploy engine: `scp D:/la-organizer/_remote/<path> tom:/opt/LA-Organizer/<path>` + `ssh tom "pm2 restart tom"`. NÃO fazer `git commit` manual — o auto-deploy hook commita/pusha no fim do turno.
- Migrations: Supabase MCP, project `cesnbnrynvxvgdhfmaua`. `ON CONFLICT (group_id, preset) DO NOTHING` (constraint `group_notification_settings_group_id_preset_key`). `preset` válido ∈ {daily_morning, weekly, monthly, overdue}.
- **NÃO TOCAR (anti-regressão):** `checkOverdueAlerts` (dispatcher.js:4712), regra `retroativa`/`shapeOpenTasks` do builder, janela 13–19h, quiet/claims, `formatHealthReport`, voz do TOM.
- Default de cobertura de grupo = preset `overdue`, `enabled=true`, `weekdays='{1,2,3,4,5,6}'`, `time_local='10:30'` (espelha o Financeiro).

## File Structure

- **Create** `src/services/uncovered-groups.js` — função pura `summarizeUncoveredGroups` + `daysLate`. Sem dependências de IO.
- **Create** `src/services/uncovered-groups.test.js` — testes node:test da função pura.
- **Modify** `src/rituals/health-check.js` — (A) filtro `assigned_to not null` em `checkOverdueTasks`; (B) novo `checkUncoveredGroups` + entrada em `ALL_CHECKS` + export.
- **Migrations** (MCP) — C1 backfill MKT; C2 função+trigger `fn_group_default_notifications`.

---

### Task 1: Função pura `summarizeUncoveredGroups`

**Files:**
- Create: `src/services/uncovered-groups.js`
- Test: `src/services/uncovered-groups.test.js`

**Interfaces:**
- Produces: `summarizeUncoveredGroups({ groups, coveredGroupIds, tasksByGroup, today, minDaysLate=2 }) → { count, groups: [{name, overdue}] }`. `tasksByGroup` é `Map<groupId, Array<{due_date}>>` já **shaped** (retroativa/done/twin fora — responsabilidade do chamador). `daysLate(dueYmd, todayYmd) → int`.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// src/services/uncovered-groups.test.js
const test = require('node:test');
const assert = require('node:assert');
const { summarizeUncoveredGroups, daysLate } = require('./uncovered-groups');

test('daysLate básico', () => {
  assert.equal(daysLate('2026-06-18', '2026-06-22'), 4);
  assert.equal(daysLate('2026-06-22', '2026-06-22'), 0); // hoje não é atraso
  assert.equal(daysLate('2026-06-25', '2026-06-22'), 0); // futuro
});

test('grupo sem cobertura com atrasada real (>=2d) é flagrado', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'MKT' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map([['g1', [{ due_date: '2026-06-18' }, { due_date: '2026-06-19' }]]]),
    today: '2026-06-22',
  });
  assert.equal(r.count, 1);
  assert.deepEqual(r.groups, [{ name: 'MKT', overdue: 2 }]);
});

test('grupo coberto (preset overdue ligado) NÃO é flagrado', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'Financeiro' }],
    coveredGroupIds: new Set(['g1']),
    tasksByGroup: new Map([['g1', [{ due_date: '2026-06-18' }]]]),
    today: '2026-06-22',
  });
  assert.equal(r.count, 0);
});

test('atraso < 2d NÃO conta', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'X' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map([['g1', [{ due_date: '2026-06-21' }]]]),
    today: '2026-06-22',
  });
  assert.equal(r.count, 0);
});

test('grupo sem tarefa NÃO é flagrado', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'g1', name: 'Vazio' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map(),
    today: '2026-06-22',
  });
  assert.equal(r.count, 0);
});

test('ordena desc por nº de atrasadas e respeita corte da lista', () => {
  const r = summarizeUncoveredGroups({
    groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    coveredGroupIds: new Set(),
    tasksByGroup: new Map([
      ['a', [{ due_date: '2026-06-18' }]],
      ['b', [{ due_date: '2026-06-18' }, { due_date: '2026-06-17' }, { due_date: '2026-06-16' }]],
    ]),
    today: '2026-06-22',
  });
  assert.deepEqual(r.groups.map((g) => g.name), ['B', 'A']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd D:/la-organizer/_remote && node --test src/services/uncovered-groups.test.js`
Expected: FAIL ("Cannot find module './uncovered-groups'").

- [ ] **Step 3: Implementar a função pura**

```js
// src/services/uncovered-groups.js
// Função pura (testável) que identifica grupos com tarefas atrasadas cuja cobrança
// de atrasadas (preset 'overdue') está desligada. NÃO sabe de retroativa/done-twin:
// recebe `tasksByGroup` já SHAPED (o chamador usa queryGroupTasks do builder, fonte
// única — evita reintroduzir GROUPREPORT-DONE-TWIN-OVERDUE).
'use strict';

// Dias de atraso (>0) de due relativo a today (ambos 'YYYY-MM-DD'); hoje/futuro/sem prazo → 0.
function daysLate(dueYmd, todayYmd) {
  if (!dueYmd || !todayYmd) return 0;
  const [y1, m1, d1] = String(todayYmd).split('-').map(Number);
  const [y2, m2, d2] = String(dueYmd).split('-').map(Number);
  if ([y1, m1, d1, y2, m2, d2].some((n) => Number.isNaN(n))) return 0;
  const diff = Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
  return diff > 0 ? diff : 0;
}

function summarizeUncoveredGroups({ groups, coveredGroupIds, tasksByGroup, today, minDaysLate = 2 } = {}) {
  const covered = coveredGroupIds instanceof Set ? coveredGroupIds : new Set(coveredGroupIds || []);
  const byGroup = tasksByGroup instanceof Map ? tasksByGroup : new Map();
  const flagged = [];
  for (const g of (groups || [])) {
    if (covered.has(g.id)) continue;
    const tasks = byGroup.get(g.id) || [];
    const overdue = tasks.filter((t) => daysLate(t.due_date, today) >= minDaysLate).length;
    if (overdue > 0) flagged.push({ name: g.name, overdue });
  }
  flagged.sort((a, b) => b.overdue - a.overdue);
  return { count: flagged.length, groups: flagged };
}

module.exports = { summarizeUncoveredGroups, daysLate };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd D:/la-organizer/_remote && node --test src/services/uncovered-groups.test.js`
Expected: PASS (todos os testes).

---

### Task 2: Check `checkUncoveredGroups` no health-check

**Files:**
- Modify: `src/rituals/health-check.js` (novo `checkUncoveredGroups`; entrada em `ALL_CHECKS` ~linha 567; export ~linha 629)

**Interfaces:**
- Consumes: `queryGroupTasks(supabase, groupId)` (group-report-builder), `summarizeUncoveredGroups` (Task 1), `todayBrt()` (já existe no health-check).
- Produces: `checkUncoveredGroups() → { status:'ok'|'warning', detail }`.

- [ ] **Step 1: Adicionar a função `checkUncoveredGroups`** (logo após `checkOverdueTasks`, antes de `// CHECK 5` ou da próxima função)

```js
// ─────────────────────────────────────────────────────────────────
// CHECK — Grupos com atrasada e cobrança (preset 'overdue') desligada
// ─────────────────────────────────────────────────────────────────
// Espelha checkOverdueTasks no eixo de GRUPO. Tarefa de grupo é cobrada por
// dispatchGroupReports (preset 'overdue'), não pelo chaser individual — então o
// check individual NÃO deve contá-la (ver filtro em checkOverdueTasks) e este
// check vigia grupos descobertos. Reusa queryGroupTasks (fonte única: retroativa,
// done-twin, molde e dedup já tratados) p/ não reintroduzir GROUPREPORT-DONE-TWIN-OVERDUE.
async function checkUncoveredGroups() {
  const { queryGroupTasks } = require('../services/group-report-builder');
  const { summarizeUncoveredGroups } = require('../services/uncovered-groups');
  const today = todayBrt();
  const { data: groups, error: gErr } = await supabase.from('work_groups').select('id, name');
  if (gErr) throw gErr;
  if (!groups || !groups.length) return { status: 'ok', detail: 'Nenhum grupo cadastrado' };
  const { data: settings, error: sErr } = await supabase
    .from('group_notification_settings')
    .select('group_id').eq('preset', 'overdue').eq('enabled', true);
  if (sErr) throw sErr;
  const coveredGroupIds = new Set((settings || []).map((s) => s.group_id));
  // Só consulta tarefas dos grupos NÃO cobertos (candidatos a descoberto).
  const tasksByGroup = new Map();
  for (const g of groups) {
    if (coveredGroupIds.has(g.id)) continue;
    try {
      const tasks = await queryGroupTasks(supabase, g.id);
      tasksByGroup.set(g.id, tasks || []);
    } catch (e) {
      console.error(`[uncovered_groups] queryGroupTasks ${String(g.id).slice(0, 8)}:`, e.message);
    }
  }
  const { count, groups: flagged } = summarizeUncoveredGroups({ groups, coveredGroupIds, tasksByGroup, today });
  if (count === 0) return { status: 'ok', detail: 'Nenhum grupo com atrasada descoberta' };
  const list = flagged.slice(0, 6).map((g) => `${g.name} (${g.overdue})`).join(', ');
  return { status: 'warning', detail: `🔴 ${count} grupo(s) com atrasada e cobrança desligada: ${list}` };
}
```

- [ ] **Step 2: Registrar no `ALL_CHECKS`** — adicionar a linha logo após `['overdue_tasks', checkOverdueTasks],`:

```js
  ['uncovered_groups',       checkUncoveredGroups],
```

- [ ] **Step 3: Exportar p/ smoke** — em `module.exports` (~linha 629), acrescentar `checkUncoveredGroups`:

```js
module.exports = { runHealthCheck, checkProviderHealth, checkGroupPackageChurn, checkUncoveredGroups };
```

- [ ] **Step 4: Sanidade de sintaxe**

Run: `cd D:/la-organizer/_remote && node --check src/rituals/health-check.js`
Expected: sem saída (sintaxe OK). (Não dá pra `require` local — `supabase/client` é só-VPS; valida-se no smoke da Task 4.)

---

### Task 3: Auditor individual mede só tarefas com dono (peça A)

**Files:**
- Modify: `src/rituals/health-check.js` — query de `checkOverdueTasks` (~linha 143-148)

- [ ] **Step 1: Adicionar o filtro `assigned_to not null`** na query de tarefas vencidas. Trocar:

```js
  const { data: overdue, error } = await supabase
    .from('tasks')
    .select('id, assigned_to, due_date')
    .gte('due_date', oldest)
    .lt('due_date', today)
    .not('status', 'in', '(done,cancelled)');
```

por:

```js
  const { data: overdue, error } = await supabase
    .from('tasks')
    .select('id, assigned_to, due_date')
    .not('assigned_to', 'is', null)        // só tarefas com dono individual: é o universo
    .gte('due_date', oldest)               // que o chaser checkOverdueAlerts realmente cobre.
    .lt('due_date', today)                 // Grupo tem trilha própria (ver checkUncoveredGroups).
    .not('status', 'in', '(done,cancelled)');
```

- [ ] **Step 2: Sanidade de sintaxe**

Run: `cd D:/la-organizer/_remote && node --check src/rituals/health-check.js`
Expected: sem saída.

- [ ] **Step 3: Validar o efeito por SQL (antes/depois)** — via MCP `execute_sql`:

```sql
select count(*) as antes,
       count(*) filter (where assigned_to is not null) as depois_com_filtro,
       count(*) filter (where assigned_to is null) as removidas_de_grupo
from tasks
where due_date >= (current_date - 5) and due_date < current_date
  and status not in ('done','cancelled');
```
Expected: `removidas_de_grupo > 0` (as de grupo somem) e `depois_com_filtro = antes - removidas_de_grupo`.

---

### Task 4: Deploy do código + smoke do check B (flagra MKT)

**Files:** nenhum (deploy + validação).

- [ ] **Step 1: SCP dos arquivos pro VPS**

```bash
scp D:/la-organizer/_remote/src/services/uncovered-groups.js tom:/opt/LA-Organizer/src/services/uncovered-groups.js
scp D:/la-organizer/_remote/src/rituals/health-check.js tom:/opt/LA-Organizer/src/rituals/health-check.js
```

- [ ] **Step 2: Rodar os testes da função pura na VPS** (garante paridade local↔VPS)

```bash
ssh tom "cd /opt/LA-Organizer && node --test src/services/uncovered-groups.test.js"
```
Expected: todos PASS. (Se o `.test.js` não tiver sido enviado, fazer `scp` dele também.)

- [ ] **Step 3: pm2 restart**

```bash
ssh tom "pm2 restart tom && sleep 3 && pm2 status tom"
```
Expected: `online`.

- [ ] **Step 4: Smoke do check B ANTES do backfill — deve flagrar o MKT**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e 'require(\"./src/rituals/health-check\").checkUncoveredGroups().then(r=>{console.log(JSON.stringify(r));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})'"
```
Expected: `{"status":"warning","detail":"🔴 1 grupo(s) com atrasada e cobrança desligada: MKT (3)"}` (ou número de atrasadas reais do MKT no dia).

---

### Task 5: Backfill do MKT (peça C1) + smoke confirma cobertura

**Files:** migration via MCP `execute_sql`.

- [ ] **Step 1: Aplicar o backfill (idempotente)**

```sql
insert into group_notification_settings (group_id, preset, enabled, weekdays, time_local)
select id, 'overdue', true, '{1,2,3,4,5,6}', '10:30'
from work_groups where name = 'MKT'
on conflict (group_id, preset) do nothing;
```

- [ ] **Step 2: Confirmar no banco**

```sql
select wg.name, gns.preset, gns.enabled, gns.weekdays, gns.time_local
from group_notification_settings gns join work_groups wg on wg.id = gns.group_id
where wg.name = 'MKT' and gns.preset = 'overdue';
```
Expected: 1 linha, `enabled=true`, `time_local=10:30`.

- [ ] **Step 3: Smoke do check B DEPOIS do backfill — MKT some**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e 'require(\"./src/rituals/health-check\").checkUncoveredGroups().then(r=>{console.log(JSON.stringify(r));process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})'"
```
Expected: `{"status":"ok","detail":"Nenhum grupo com atrasada descoberta"}` (MKT agora coberto; nenhum outro grupo tem atrasada real hoje).

---

### Task 6: Trigger — grupo novo nasce coberto (peça C2)

**Files:** migration via MCP `apply_migration` (DDL).

- [ ] **Step 1: Aplicar função + trigger (re-executável)**

```sql
create or replace function fn_group_default_notifications()
returns trigger language plpgsql security definer as $$
begin
  insert into group_notification_settings (group_id, preset, enabled, weekdays, time_local)
  values (NEW.id, 'overdue', true, '{1,2,3,4,5,6}', '10:30')
  on conflict (group_id, preset) do nothing;
  return NEW;
exception when others then
  return NEW;  -- nunca derruba a criação do grupo
end; $$;

drop trigger if exists trg_group_default_notifications on work_groups;
create trigger trg_group_default_notifications
after insert on work_groups
for each row execute function fn_group_default_notifications();
```

- [ ] **Step 2: Testar o trigger sem deixar resíduo** (transação revertida) — via `execute_sql`:

```sql
begin;
insert into work_groups (name, slug, leader_id, created_by)
values ('ZZ_TRIGGER_TEST', 'zz-trigger-test',
        (select id from collaborators where is_active limit 1),
        (select id from collaborators where is_active limit 1));
select preset, enabled, time_local
from group_notification_settings
where group_id = (select id from work_groups where slug = 'zz-trigger-test');
rollback;
```
Expected: o SELECT retorna 1 linha (`overdue`, `true`, `10:30`) — o trigger criou o preset; o `rollback` desfaz tudo (nenhum grupo/preset de teste persiste).
Fallback (se o MCP não exibir o SELECT intermediário): trocar `rollback` por `commit`, conferir, e `delete from work_groups where slug='zz-trigger-test';` (cascade remove o preset).

- [ ] **Step 3: Confirmar que nada de teste sobrou**

```sql
select count(*) as resto from work_groups where slug = 'zz-trigger-test';
```
Expected: `0`.

---

### Task 7: Registro no ledger + memória

**Files:** `tom_known_issues` (MCP) + memória local.

- [ ] **Step 1: Registrar o known issue** (via `execute_sql`)

```sql
insert into tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
values (
  'GOVAUDIT-GROUP-OVERDUE-BLINDSPOT',
  'Auditoria 07h acusava tarefa de GRUPO como "sem cobrança" cronicamente (cega ao canal de grupo) + grupo sem config nunca cobrado',
  'health-check', 'medio', 'corrigido',
  'checkOverdueTasks media cobranca so por notifications (overdue/deadline_alert), alimentada so pelo chaser individual checkOverdueAlerts que so cobra assigned_to. Tarefa de grupo (assigned_group_id, assigned_to null) e cobrada por dispatchGroupReports (group_ritual_logs), nunca gera notification -> auditor cego, reportava grupo como sem cobranca pra sempre. + grupo sem group_notification_settings (MKT) nunca cobrado.',
  'A) checkOverdueTasks filtra assigned_to not null (mede so o universo do chaser). B) check novo uncovered_groups reusa queryGroupTasks (retroativa/done-twin filtrados) e vigia grupo com atrasada real + preset overdue off. C1) backfill preset overdue no MKT. C2) trigger fn_group_default_notifications faz grupo novo nascer com preset overdue (security definer, exception-safe).',
  'manual',
  'relatorio 07h listando tarefa de grupo (assigned_group_id not null) como "vencida sem cobranca"; grupo com atrasada real e group_notification_settings sem preset overdue enabled',
  ARRAY['MKT'], now(), now(), 1, now()
);
```

- [ ] **Step 2: Atualizar a memória** — em `project_audit_0622_cobranca_grupo.md`, trocar "Fix em brainstorm" / "PENDENTE" por "ENTREGUE 22/06 (GOVAUDIT-GROUP-OVERDUE-BLINDSPOT)" com o resumo do que entrou. Atualizar a linha no `MEMORY.md`.

- [ ] **Step 3: Smoke final do relatório** — confirmar que `overdue_tasks` e `uncovered_groups` convivem bem:

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e 'const h=require(\"./src/rituals/health-check\"); h.checkUncoveredGroups().then(r=>console.log(\"uncovered:\",JSON.stringify(r)))'"
```
Expected: `uncovered: {"status":"ok",...}`. O auto-deploy hook commita/pusha no fim do turno.

---

## Self-Review (preenchido)

- **Cobertura do spec:** A→Task 3; B→Tasks 1+2; C1→Task 5; C2→Task 6; registro→Task 7. ✓
- **Placeholders:** nenhum — todo código e SQL completos. ✓
- **Consistência de tipos:** `summarizeUncoveredGroups`/`daysLate` (Task 1) usados igual no check (Task 2); `tasksByGroup` é `Map` nos dois; `queryGroupTasks` assinatura confirmada (exportada). ✓
- **Anti-regressão:** check B reusa `queryGroupTasks` (não reconta → não regride done-twin/retroativa); A só adiciona filtro; trigger exception-safe. ✓
