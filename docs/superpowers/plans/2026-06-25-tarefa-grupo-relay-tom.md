# Tarefa de grupo — TOM relay (descrição + autor) + baixa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** o TOM passa descrição + quem criou de tarefas de grupo (pool) no contexto e no lembrete; baixa já existe (confirmar).

**Architecture:** 1 util puro novo (`group-task-relay.js`) com 2 funções de formatação (TDD); system.js e dispatcher.js só enriquecem o SELECT e chamam o util. Baixa = confirmação E2E no banco (sem código).

**Tech Stack:** Node CJS, Supabase JS, node:test.

## Global Constraints
- Zero regressão; **voz sagrada** (só DADO no contexto + lembrete — pedido do Alf — nunca tom/tamanho das respostas de conversa).
- `.deploy-hold` na raiz do `_remote` ANTES de editar `src/`; soltar na task de deploy.
- Deploy = `scp` + `pm2 restart` (permitido, sem pedir). `node --check` em cada arquivo.
- NÃO reabrir GROUP-RECUR-TEMPLATE-VISIBLE-TO-TOM → manter `filterVisibleGroupTasks`.
- FK do criador: `tasks_created_by_fkey`; nome via `preferred_name || full_name` (padrão group-report-builder.js).
- Mensagem Gabi/João = FORA deste plano; só no fim, com OK explícito do Alf.

---

### Task 1: util puro `group-task-relay.js` (TDD)

**Files:**
- Create: `src/utils/group-task-relay.js`
- Test: `src/utils/group-task-relay.test.js`

**Produces:** `buildGroupPoolLines(tasks, groups, today, fmtDate) -> string[]`; `buildGroupTaskReminderText({label,title,when,creatorFirstName,description}) -> string`; `firstNameOf(person)`; `truncDesc(text, max)`.

- [ ] **Step 1: Test (falha)** — `src/utils/group-task-relay.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildGroupPoolLines, buildGroupTaskReminderText, firstNameOf, truncDesc } = require('./group-task-relay');

const fmt = (ymd) => (ymd === '2026-06-25' ? 'hoje' : ymd);

test('firstNameOf: preferred_name > full_name > vazio', () => {
  assert.strictEqual(firstNameOf({ preferred_name: 'Vi', full_name: 'Vitoria Souza' }), 'Vi');
  assert.strictEqual(firstNameOf({ full_name: 'Vitoria Souza' }), 'Vitoria');
  assert.strictEqual(firstNameOf(null), '');
});

test('truncDesc: colapsa espaços + corta com reticências', () => {
  assert.strictEqual(truncDesc('  a   b \n c ', 100), 'a b c');
  assert.strictEqual(truncDesc('x'.repeat(250), 240).length, 241);
  assert.strictEqual(truncDesc('', 100), '');
});

test('pool: tarefa com criador + descrição vira 2 linhas', () => {
  const tasks = [{ id: 'abcd1234', title: 'Ligar para aluno', due_date: '2026-06-25', assigned_group_id: 'g1', description: 'Aluno: Leandro\nAssunto: trancamento', creator: { full_name: 'Vitoria Souza' } }];
  const lines = buildGroupPoolLines(tasks, [{ id: 'g1', name: 'ADM CG' }], '2026-06-25', fmt);
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /👥\[ADM CG\] Ligar para aluno — hoje · criada por Vitoria/);
  assert.match(lines[1], /↳ Aluno: Leandro Assunto: trancamento/);
});

test('pool: sem descrição/criador → 1 linha só, grupo "grupo" quando não acha', () => {
  const lines = buildGroupPoolLines([{ id: 'ef56', title: 'X', assigned_group_id: 'g9' }], [], '2026-06-25', fmt);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /👥\[grupo\] X/);
  assert.doesNotMatch(lines[0], /criada por/);
});

test('lembrete: descrição + criador', () => {
  const txt = buildGroupTaskReminderText({ label: null, title: 'Ligar para aluno', when: 'hoje', creatorFirstName: 'Vitoria', description: 'Aluno: Leandro, trancamento' });
  assert.match(txt, /^⏰ Lembrete: \*Ligar para aluno\* \(grupo\) — hoje/);
  assert.match(txt, /_criada por Vitoria:_ Aluno: Leandro, trancamento/);
});

test('lembrete: sem descrição nem criador = formato atual intacto', () => {
  const txt = buildGroupTaskReminderText({ label: null, title: 'X', when: 'hoje', creatorFirstName: '', description: '' });
  assert.strictEqual(txt, '⏰ Lembrete: *X* (grupo) — hoje');
});

test('lembrete: descrição longa ganha "abre no app"', () => {
  const txt = buildGroupTaskReminderText({ label: 'Bom dia', title: 'X', when: '', creatorFirstName: 'Vi', description: 'y'.repeat(250) });
  assert.match(txt, /abre no app pra ver tudo/);
  assert.match(txt, /^⏰ Bom dia: \*X\* \(grupo\)/);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd /d/la-organizer/_remote && node --test src/utils/group-task-relay.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** — `src/utils/group-task-relay.js`:
```js
'use strict';
// Formatação pura de tarefas de GRUPO (pool) p/ as superfícies do TOM: contexto do prompt
// (buildGroupPoolLines) e lembrete de WhatsApp (buildGroupTaskReminderText). Sem I/O — o
// caller injeta os dados (já com join do criador) e o fmtDate. Nasce de NOTE: o pool não
// levava descrição/autor (context-gap) → membro só via título e TOM dizia "não sei quem criou".

function firstNameOf(person) {
  if (!person) return '';
  const n = person.preferred_name || person.full_name || '';
  return String(n).trim().split(/\s+/)[0] || '';
}

function truncDesc(text, max) {
  const d = String(text || '').trim().replace(/\s+/g, ' ');
  if (!d) return '';
  return d.length > max ? d.slice(0, max) + '…' : d;
}

// Espelha o padrão do renderTaskList (system.js:462) p/ as tarefas de pool do membro.
// fmtDate(dueYmd, today) injetado (formatRelativeDate) p/ manter puro.
function buildGroupPoolLines(tasks, groups, today, fmtDate) {
  const out = [];
  const list = Array.isArray(tasks) ? tasks : [];
  const gs = Array.isArray(groups) ? groups : [];
  for (const t of list) {
    if (!t) continue;
    const g = gs.find((x) => x && x.id === t.assigned_group_id);
    const sid = String(t.id || '').slice(0, 8);
    const due = t.due_date ? ` — ${(fmtDate && fmtDate(t.due_date, today)) || t.due_date}` : '';
    const cn = firstNameOf(t.creator);
    const by = cn ? ` · criada por ${cn}` : '';
    out.push(`• [id=${sid}] 👥[${g ? g.name : 'grupo'}] ${t.title}${due}${by}`);
    const desc = truncDesc(t.description, 240);
    if (desc) out.push(`   ↳ ${desc}`);
  }
  return out;
}

// 1ª linha = formato atual (intocado p/ não regredir o que já funciona). Anexa autor+descrição
// curta quando houver. Omite gracioso quando faltam (criador ausente nunca quebra o lembrete).
function buildGroupTaskReminderText({ label, title, when, creatorFirstName, description } = {}) {
  const lab = label ? `${label}: ` : 'Lembrete: ';
  let txt = `⏰ ${lab}*${title}* (grupo)${when ? ` — ${when}` : ''}`;
  const desc = truncDesc(description, 200);
  const by = creatorFirstName ? `criada por ${creatorFirstName}` : '';
  if (desc && by) txt += `\n_${by}:_ ${desc}`;
  else if (desc) txt += `\n${desc}`;
  else if (by) txt += `\n_${by}_`;
  if (desc && String(description || '').trim().length > 200) txt += '\n_abre no app pra ver tudo_';
  return txt;
}

module.exports = { buildGroupPoolLines, buildGroupTaskReminderText, firstNameOf, truncDesc };
```

- [ ] **Step 4: Rodar e passar** — `node --test src/utils/group-task-relay.test.js` → 7/7 PASS.

---

### Task 2: F1 — wire no prompt (`system.js`)

**Files:** Modify `src/prompts/system.js` (loader ~1761-1766 + render ~542-551)
**Consumes:** `buildGroupPoolLines` da Task 1.

- [ ] **Step 1: `.deploy-hold`** — `printf '%s\n' 'HOLD revisor: TOM relay tarefa de grupo (system.js+dispatcher.js)' > /d/la-organizer/_remote/.deploy-hold`

- [ ] **Step 2: Enriquecer o SELECT do loader** (system.js ~1761):
  Trocar:
```js
      const { data: gt } = await supabase.from('tasks')
        .select('id, title, due_date, status, assigned_group_id, is_group, recurrence_rule, parent_task_id')
```
  por:
```js
      const { data: gt } = await supabase.from('tasks')
        .select('id, title, description, due_date, status, assigned_group_id, is_group, recurrence_rule, parent_task_id, created_by, creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
```

- [ ] **Step 3: Trocar o render** (system.js ~542-551). Trocar o bloco:
```js
    if (workGroupsCtx.myGroupTasks && workGroupsCtx.myGroupTasks.length) {
      const today = todaySaoPaulo();
      lines.push('', '**Tarefas abertas dos SEUS grupos (você também pode concluir):**');
      workGroupsCtx.myGroupTasks.forEach((t) => {
        const g = workGroupsCtx.groups.find((x) => x.id === t.assigned_group_id);
        const sid = String(t.id || '').slice(0, 8);
        const due = t.due_date ? ` — ${formatRelativeDate(t.due_date, today) || t.due_date}` : '';
        lines.push(`• [id=${sid}] 👥[${g ? g.name : 'grupo'}] ${t.title}${due}`);
      });
    }
```
  por:
```js
    if (workGroupsCtx.myGroupTasks && workGroupsCtx.myGroupTasks.length) {
      const today = todaySaoPaulo();
      lines.push('', '**Tarefas abertas dos SEUS grupos (você também pode concluir):**');
      const { buildGroupPoolLines } = require('../utils/group-task-relay');
      for (const ln of buildGroupPoolLines(workGroupsCtx.myGroupTasks, workGroupsCtx.groups, today, formatRelativeDate)) {
        lines.push(ln);
      }
    }
```

- [ ] **Step 4: `node --check`** — `node --check src/prompts/system.js` → sem erro.

- [ ] **Step 5: Suíte não regride** — `node --test $(find src -name '*.test.js')` → só as 2 falhas de baseline ambiente (engine.guardrail + pending-intents-detect).

---

### Task 3: F2 — wire no lembrete (`dispatcher.js checkTaskReminders`)

**Files:** Modify `src/rituals/dispatcher.js` (query ~4988 + branch grupo ~5011-5014)
**Consumes:** `buildGroupTaskReminderText`, `firstNameOf` da Task 1.

- [ ] **Step 1: Enriquecer o SELECT** (dispatcher ~4988). Trocar:
```js
    .select('id, task_id, remind_at, label, created_at, tasks(id, title, assigned_to, assigned_group_id, status, due_date, due_time)')
```
  por:
```js
    .select('id, task_id, remind_at, label, created_at, tasks(id, title, description, assigned_to, assigned_group_id, status, due_date, due_time, created_by, creator:collaborators!tasks_created_by_fkey(preferred_name, full_name))')
```

- [ ] **Step 2: Trocar a montagem do texto de grupo** (dispatcher ~5011-5014). Trocar:
```js
        const labelG = r.label ? `${r.label}: ` : 'Lembrete: ';
        const dayG = relativeDayFromYmd(t.due_date);
        const whenG = [dayG, (t.due_time || '').slice(0, 5)].filter(Boolean).join(' ');
        const textG = `⏰ ${labelG}*${t.title}* (grupo)${whenG ? ` — ${whenG}` : ''}`;
```
  por:
```js
        const { buildGroupTaskReminderText, firstNameOf } = require('../utils/group-task-relay');
        const dayG = relativeDayFromYmd(t.due_date);
        const whenG = [dayG, (t.due_time || '').slice(0, 5)].filter(Boolean).join(' ');
        const textG = buildGroupTaskReminderText({ label: r.label, title: t.title, when: whenG, creatorFirstName: firstNameOf(t.creator), description: t.description });
```

- [ ] **Step 3: Verificar superfícies-irmãs** — `grep -n "remindGroupTasks\|Lembrete (grupo):" src/rituals/dispatcher.js`. `remindGroupTasks` (~1054, ritual diário 09h) e `checkReminders` branch grupo (~5125) são outras superfícies. Decisão registrada no plano: **só `checkTaskReminders` foi enriquecido** (é a superfície do print Gabi/João — `task_reminders` multi). As outras ficam de fora desta fatia (consistência futura) — `log` no commit/relato, sem cap silencioso.

- [ ] **Step 4: `node --check`** — `node --check src/rituals/dispatcher.js` → sem erro.

---

### Task 4: F3 — confirmar baixa de pool (E2E banco, sem código)

- [ ] **Step 1: Confirmar o caminho** — reler `engine.js:4181-4250`: branch `if (t.assigned_group_id)` conclui via `.eq('id',t.id).eq('assigned_group_id',...).neq('status','done')` + notifica grupo. `resolveTaskByShortId` (3577-3586) já inclui pool dos grupos do membro. Conclusão esperada: baixa de pool no 1:1 **já funciona**.
- [ ] **Step 2: Evidência no banco** — query Supabase:
```sql
SELECT count(*) AS pool_done_by_member
FROM tasks
WHERE assigned_group_id IS NOT NULL AND assigned_to IS NULL
  AND status='done' AND completed_by IS NOT NULL AND completed_by <> created_by;
```
  Esperado: `>0` (prova que membro não-criador já concluiu pool em produção). Se `0`, registrar que não há evidência histórica e marcar a baixa p/ smoke manual no teste final (não bloqueia o relay).

---

### Task 5: F4 — deploy + KI + memória

- [ ] **Step 1: Deploy** — `scp src/utils/group-task-relay.js src/prompts/system.js src/rituals/dispatcher.js` p/ `tom:/opt/LA-Organizer/...` (paths absolutos `/d/...`); `ssh tom "pm2 restart tom"`.
- [ ] **Step 2: Boot limpo** — `ssh tom "pm2 describe tom | grep -E 'status|unstable'"` → online, unstable 0.
- [ ] **Step 3: Smoke VPS do util** — `ssh tom "cd /opt/LA-Organizer && node -e \"const u=require('./src/utils/group-task-relay'); console.log(u.buildGroupTaskReminderText({title:'Ligar',when:'hoje',creatorFirstName:'Vitoria',description:'Aluno X'}))\""` → mostra "criada por Vitoria".
- [ ] **Step 4: Soltar hold** — `rm -f /d/la-organizer/_remote/.deploy-hold`.
- [ ] **Step 5: KI** — INSERT `tom_known_issues` `GROUPTASK-TOM-RELAY-NOCTX` (área coordination/marker; causa = pool no prompt/lembrete sem description/created_by [context-gap, não derrotismo]; fix = util group-task-relay + enriquecer loader system.js + lembrete checkTaskReminders; baixa já existia engine.js:4182).
- [ ] **Step 6: Memória + relato** — atualizar memória do tema; relatar ao Alf p/ aprovar a mensagem Gabi/João.

## Self-review
- **Cobertura da spec:** F1 (Task 2) ✓ · F2 (Task 3) ✓ · F3 baixa (Task 4) ✓ · F4 (Task 5) ✓ · helpers puros TDD (Task 1) ✓.
- **Voz sagrada:** lembrete 1ª linha intocada; só anexa dado. Contexto = dado. ✓
- **Sem placeholder:** todo step tem código/comando exato. ✓
- **Consistência de tipos:** `t.creator` (objeto do join) → `firstNameOf`; `buildGroupPoolLines(tasks, groups, today, fmtDate)` e `buildGroupTaskReminderText({...})` batem entre Tasks 1/2/3. ✓
