# Snooze de lembrete por tarefa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao TOM a ação de silenciar/atrasar os lembretes de UMA tarefa ("só me lembra às 15h" / "para de me lembrar antes das 15h" / "não me lembra mais dessa tarefa"), em vez de só dar ACK e seguir disparando a grade.

**Architecture:** Toda a lógica de decisão fica numa função PURA testável (`planReminderFloor`); o engine só faz plumbing (resolve a tarefa → busca lembretes → chama o helper → aplica). Nova action `snooze_reminders` no marker `<<TASK_UPDATE>>`. Semântica = **piso**: consome (marca `sent_at=now()`) os lembretes anteriores ao horário e mantém os posteriores; `clear_all` silencia todos. Engine escreve via service_role (sem RLS nova). Não toca o Balde A (recorrência).

**Tech Stack:** Node.js (CommonJS), Supabase JS (service_role no engine), skills `.md`. Testes = scripts standalone com `node:assert` (não há framework no backend).

**Spec:** `docs/superpowers/specs/2026-06-19-snooze-lembrete-por-tarefa-design.md`

---

## ⚠️ Convenções deste projeto (LEIA antes de executar)

- **NÃO commitar entre tasks.** O `CLAUDE.md` manda trabalhar tudo local em `_remote/` e o Stop hook (auto-deploy) commita+pusha no fim do turno. Cada task abaixo termina em **verificação**, não em `git commit`.
- **HOLD de deploy ativo** (`D:\la-organizer\.deploy-hold`): **NÃO** fazer SCP/`pm2 restart`/deploy. A **Task 6** (E2E na VPS) só roda depois que o Alf remover o HOLD.
- **Balde A — NÃO TOCAR:** `recurrence-engine.js`, `utils/recurring-dedup.js`, `utils/task-update-result.js`, o `complete`/`cancel` `scope:"series"` do `engine.js`, o dedup em `system.js`/`dispatcher.js`. Nada neste plano os toca.
- Validação local de sintaxe backend: `node --check src/<arquivo>.js`.

---

## File Structure

| Arquivo | Papel | Ação |
|---|---|---|
| `src/services/reschedule-reminders.js` | Helpers puros de ajuste de `remind_at` de tarefa | **Modificar** — add `planReminderFloor` + export |
| `scripts/test-reminder-floor.js` | Teste standalone do helper puro | **Criar** |
| `src/engine.js` | Parser/validação/aplicação de markers de tarefa | **Modificar** — registrar action, validar, aplicar |
| `skills/checklist-tarefas.md` | Skill de tarefas/lembretes | **Modificar** — regra + exemplos + veto anti-app |
| `skills/configurar-preferencias.md` | Skill de preferências globais | **Modificar** — 1 nota de cross-ref |

---

## Task 1: Helper puro `planReminderFloor` (TDD)

**Files:**
- Create: `scripts/test-reminder-floor.js`
- Modify: `src/services/reschedule-reminders.js` (add função + export na linha 56)

- [ ] **Step 1: Escrever o teste que falha**

Create `scripts/test-reminder-floor.js`:

```javascript
// Teste standalone do helper puro planReminderFloor (item #5 audit 15/06, caso Jereh).
// Função PURA — roda SEM Supabase/env. Uso: node scripts/test-reminder-floor.js
'use strict';
const assert = require('node:assert/strict');
const { planReminderFloor } = require('../src/services/reschedule-reminders');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.error(`  FAIL ${name}\n       ${e.message}`); }
}

const NOW = Date.parse('2026-06-19T12:00:00-03:00'); // "agora" de referência
const FLOOR = '2026-06-19T15:00:00-03:00';
const r = (id, hhmm, label) => ({ id, remind_at: `2026-06-19T${hhmm}:00-03:00`, label: label || null });

// 1) Piso no meio: consome só os anteriores, mantém os >= piso, sem insert.
t('piso no meio: consome antes, mantem depois', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','13:00'), r('b','14:00'), r('c','15:00'), r('d','16:00')],
    taskRemindAt: null, taskRemindedAt: null, notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b']);
  assert.equal(p.insertReminder, null);
  assert.equal(p.taskPatch, null);
});

// 2) Grade toda antes do piso: consome todos + ensure-one no piso (herda label).
t('grade toda antes: consome todos + ensure-one', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','09:00','Reunião'), r('b','11:00'), r('c','13:00')],
    taskRemindAt: null, taskRemindedAt: null, notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b','c']);
  assert.deepEqual(p.insertReminder, { remind_at: FLOOR, label: 'Reunião' });
});

// 3) Piso no passado: consome anteriores, NÃO cria no passado.
t('piso no passado: sem ensure-one', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','08:00'), r('b','09:00')],
    taskRemindAt: null, taskRemindedAt: null,
    notBefore: '2026-06-19T10:00:00-03:00', clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b']);
  assert.equal(p.insertReminder, null);
});

// 4) clearAll: consome todos, sem insert, limpa one-shot pendente.
t('clearAll: consome tudo + limpa one-shot', () => {
  const p = planReminderFloor({
    pendingRows: [r('a','13:00'), r('b','16:00')],
    taskRemindAt: '2026-06-19T18:00:00-03:00', taskRemindedAt: null,
    notBefore: null, clearAll: true, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, ['a','b']);
  assert.equal(p.insertReminder, null);
  assert.deepEqual(p.taskPatch, { remind_at: null });
});

// 5) One-shot antes do piso (sem grade): move pro piso, sem ensure-one.
t('one-shot antes do piso: move pro piso', () => {
  const p = planReminderFloor({
    pendingRows: [],
    taskRemindAt: '2026-06-19T13:00:00-03:00', taskRemindedAt: null,
    notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.taskPatch, { remind_at: FLOOR });
  assert.equal(p.insertReminder, null);
  assert.deepEqual(p.consumeReminderIds, []);
});

// 6) One-shot já >= piso: no-op.
t('one-shot ja no/depois do piso: no-op', () => {
  const p = planReminderFloor({
    pendingRows: [],
    taskRemindAt: '2026-06-19T17:00:00-03:00', taskRemindedAt: null,
    notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.equal(p.taskPatch, null);
  assert.equal(p.insertReminder, null);
});

// 7) One-shot já disparado (reminded_at preenchido) e sem grade: no-op (não inventa lembrete).
t('one-shot ja disparado, sem grade: no-op', () => {
  const p = planReminderFloor({
    pendingRows: [],
    taskRemindAt: '2026-06-19T13:00:00-03:00', taskRemindedAt: '2026-06-19T13:00:05-03:00',
    notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.equal(p.taskPatch, null);
  assert.equal(p.insertReminder, null);
  assert.deepEqual(p.consumeReminderIds, []);
});

// 8) Idempotência: 2ª chamada com a grade já no piso → no-op.
t('idempotente: 2a chamada e no-op', () => {
  const p = planReminderFloor({
    pendingRows: [r('novo','15:00')],
    taskRemindAt: null, taskRemindedAt: null, notBefore: FLOOR, clearAll: false, nowMs: NOW,
  });
  assert.deepEqual(p.consumeReminderIds, []);
  assert.equal(p.insertReminder, null);
});

console.log(`\nplanReminderFloor: ${pass}/${pass + fail} passaram`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd D:\la-organizer\_remote && node scripts/test-reminder-floor.js`
Expected: FAIL — `TypeError: planReminderFloor is not a function` (ainda não existe/exportado).

- [ ] **Step 3: Implementar `planReminderFloor`**

Em `src/services/reschedule-reminders.js`, **antes** da linha `module.exports = ...` (linha 56), adicionar:

```javascript
/**
 * Snooze/silêncio de lembrete POR TAREFA (item #5 audit 15/06, caso Jereh).
 * Função PURA: dado o conjunto de lembretes pendentes de UMA tarefa e um piso de horário
 * (notBefore), decide o que silenciar, se precisa garantir 1 lembrete no piso, e como
 * ajustar o remind_at one-shot da própria task. Semântica = PISO: limpa só o ANTERIOR ao
 * piso; mantém a grade posterior. Sem I/O — o caller aplica o plano.
 *
 * @param {Object} p
 * @param {Array<{id:string,remind_at:string,label?:string}>} p.pendingRows — task_reminders com sent_at IS NULL
 * @param {string|null} p.taskRemindAt   — tasks.remind_at (one-shot) ou null
 * @param {string|null} p.taskRemindedAt — tasks.reminded_at ou null (preenchido = one-shot já disparou)
 * @param {string|null} p.notBefore      — piso ISO 8601 com timezone (null quando clearAll)
 * @param {boolean} p.clearAll           — true = silenciar TODOS os pendentes (sem ensure-one)
 * @param {number} p.nowMs               — Date.now() do caller (injetado p/ função ficar pura)
 * @returns {{consumeReminderIds:string[], insertReminder:{remind_at:string,label:string|null}|null, taskPatch:{remind_at:string|null}|null}}
 */
function planReminderFloor({ pendingRows, taskRemindAt, taskRemindedAt, notBefore, clearAll, nowMs }) {
  const rows = Array.isArray(pendingRows) ? pendingRows : [];
  const out = { consumeReminderIds: [], insertReminder: null, taskPatch: null };

  // Modo "silenciar tudo": consome todos os pendentes e remove o lembrete one-shot
  // (se ainda não disparou). Sem ensure-one.
  if (clearAll || !notBefore) {
    out.consumeReminderIds = rows.map((r) => r.id);
    if (taskRemindAt && !taskRemindedAt) out.taskPatch = { remind_at: null };
    return out;
  }

  const floorMs = Date.parse(notBefore);
  if (!Number.isFinite(floorMs)) return out; // piso inválido → no-op defensivo

  // 1) PISO na grade: consome os rows ANTERIORES ao piso; mantém os >= piso.
  let coveredAtOrAfter = false;
  let labelForInsert = null;
  for (const r of rows) {
    const rm = Date.parse(r && r.remind_at);
    if (!Number.isFinite(rm)) continue;
    if (rm < floorMs) {
      out.consumeReminderIds.push(r.id);
      if (labelForInsert === null && typeof r.label === 'string' && r.label) labelForInsert = r.label;
    } else {
      coveredAtOrAfter = true;
    }
  }

  // 2) PISO no one-shot (tasks.remind_at): se anterior ao piso e ainda não disparou,
  //    move pro piso (vira a cobertura). Se já é >= piso, só marca como coberto.
  if (taskRemindAt && !taskRemindedAt) {
    const trm = Date.parse(taskRemindAt);
    if (Number.isFinite(trm)) {
      if (trm < floorMs) { out.taskPatch = { remind_at: notBefore }; coveredAtOrAfter = true; }
      else coveredAtOrAfter = true;
    }
  }

  // 3) ENSURE-ONE: só quando ALGO da grade foi silenciado e nada restou cobrindo o piso,
  //    e o piso é FUTURO. Não inventa lembrete do zero (task sem lembrete → "me lembra às X"
  //    é create/reschedule, não snooze). Nunca cria no passado (evita REMINDER-STALE-PAST).
  const silencedGrid = out.consumeReminderIds.length > 0;
  if (silencedGrid && !coveredAtOrAfter && floorMs > nowMs) {
    out.insertReminder = { remind_at: notBefore, label: labelForInsert };
  }

  return out;
}
```

E trocar a linha 56:

```javascript
module.exports = { shiftRemindersByReschedule, shiftTaskRemindAt };
```

por:

```javascript
module.exports = { shiftRemindersByReschedule, shiftTaskRemindAt, planReminderFloor };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd D:\la-organizer\_remote && node scripts/test-reminder-floor.js`
Expected: PASS — `planReminderFloor: 8/8 passaram` e exit 0.

- [ ] **Step 5: Checar sintaxe do módulo**

Run: `cd D:\la-organizer\_remote && node --check src/services/reschedule-reminders.js`
Expected: sem saída, exit 0.

---

## Task 2: Registrar e validar a action `snooze_reminders` no engine

**Files:**
- Modify: `src/engine.js:143` (VALID_TASK_ACTIONS) e `src/engine.js:3346` (validateTaskAction)

- [ ] **Step 1: Adicionar a action ao set válido**

Em `src/engine.js`, trocar (linha 143-146):

```javascript
const VALID_TASK_ACTIONS = new Set([
  'complete', 'cancel', 'reschedule', 'create', 'delegate',
  'extension_request', 'extension_decision', 'governance_reassign',
]);
```

por:

```javascript
const VALID_TASK_ACTIONS = new Set([
  'complete', 'cancel', 'reschedule', 'create', 'delegate',
  'extension_request', 'extension_decision', 'governance_reassign',
  'snooze_reminders',
]);
```

- [ ] **Step 2: Adicionar o branch de validação**

Em `validateTaskAction` (a cadeia de `if (a.action === ...)` que começa na linha 3363), adicionar um novo branch. Localize o branch `} else if (a.action === 'governance_reassign') {` (linha 3416) e, **logo após o fechamento dele** (a linha `}` antes do comentário `// Sprint 29.4 — recurrence_rule`), insira:

```javascript
  } else if (a.action === 'snooze_reminders') {
    // Snooze/silêncio de lembrete POR TAREFA (item #5 audit 15/06). Aceita id OU title
    // (resolução em applyTaskActions, igual reschedule). Exige not_before (piso ISO com
    // timezone) OU clear_all=true ("não me lembra mais dessa tarefa").
    const hasId = typeof a.id === 'string' && SHORT_ID_RE.test(a.id);
    const hasTitle = typeof a.title === 'string' && a.title.trim().length > 0;
    if (!hasId && !hasTitle) return 'bad_id';
    const clearAll = a.clear_all === true || a.clear_all === 'true';
    if (!clearAll && !isValidRemindAt(a.not_before)) return 'snooze_needs_not_before_or_clear_all';
```

> Nota: `SHORT_ID_RE` (linha 142) e `isValidRemindAt` (função declarada na linha 5333, hoisted) já estão no escopo. `isValidRemindAt` aceita exatamente ISO 8601 com timezone (`...T15:00:00-03:00` ou `...Z`), que é o formato do piso.

- [ ] **Step 3: Checar sintaxe**

Run: `cd D:\la-organizer\_remote && node --check src/engine.js`
Expected: sem saída, exit 0.

---

## Task 3: Aplicar a action em `applyTaskActions`

**Files:**
- Modify: `src/engine.js` (dentro de `applyTaskActions`, função que começa na linha 4023; o loop `for (const a of actions)` na linha 4085)

- [ ] **Step 1: Adicionar o branch de aplicação**

Localize, dentro do `for (const a of actions)`, o fim do branch `} else if (a.action === 'reschedule') {` (começa na linha 4365). Vá até onde esse branch fecha (o próximo `} else if (a.action === ...)` da cadeia, p.ex. `delegate`). **Antes** desse próximo `else if`, insira o novo branch:

```javascript
      } else if (a.action === 'snooze_reminders') {
        // SNOOZE/silêncio de lembrete POR TAREFA (item #5 audit 15/06, caso Jereh).
        // NÃO altera prazo nem conclui a tarefa — só reorganiza os lembretes.
        let t = null;
        if (!a.id && a.title) {
          const like = `%${String(a.title).slice(0, 60)}%`;
          // (a) tarefa onde o remetente é assignee ou criador (igual reschedule)
          const { data: own } = await supabase
            .from('tasks')
            .select('id, title, status, assigned_to, created_by, assigned_group_id')
            .or(`assigned_to.eq.${collaborator.id},created_by.eq.${collaborator.id}`)
            .ilike('title', like)
            .not('status', 'in', '("done","cancelled")')
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (own) {
            t = own;
          } else {
            // (b) tarefa de GRUPO do qual o remetente é membro (decisão 19/06: snooze de
            //     grupo vale pra todos — a grade é compartilhada). groupIdsOfCollaborator
            //     restringe à membership, então é a própria autorização.
            const wg = require('./services/work-groups');
            const gids = await wg.groupIdsOfCollaborator(supabase, collaborator.id);
            if (gids && gids.length) {
              const { data: grp } = await supabase
                .from('tasks')
                .select('id, title, status, assigned_to, created_by, assigned_group_id')
                .in('assigned_group_id', gids)
                .ilike('title', like)
                .not('status', 'in', '("done","cancelled")')
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
              if (grp) t = grp;
            }
          }
          if (t) {
            a.id = t.id.replace(/-/g, '').slice(0, 8);
          } else {
            console.warn(`[Task] snooze title-lookup failed: "${a.title}" not found for ${last4}`);
            failMessages.push(`Não achei a tarefa _"${String(a.title).slice(0, 60)}"_ pra ajustar os lembretes. Me diz o nome certinho?`);
            failCount++;
            continue;
          }
        } else {
          t = await resolveTaskByShortId(collaborator.id, a.id);
        }
        if (!t) {
          console.warn(`[Task] snooze REJECTED id=${a.id} (not owned by ${last4} or not found)`);
          failCount++;
          continue;
        }
        // Dados frescos do one-shot da própria task + grade pendente.
        const { data: curSnz } = await supabase
          .from('tasks').select('remind_at, reminded_at').eq('id', t.id).maybeSingle();
        const { data: pendSnz } = await supabase
          .from('task_reminders').select('id, remind_at, label').eq('task_id', t.id).is('sent_at', null);
        const clearAllSnz = a.clear_all === true || a.clear_all === 'true';
        const planSnz = planReminderFloor({
          pendingRows: pendSnz || [],
          taskRemindAt: curSnz ? curSnz.remind_at : null,
          taskRemindedAt: curSnz ? curSnz.reminded_at : null,
          notBefore: typeof a.not_before === 'string' ? a.not_before : null,
          clearAll: clearAllSnz,
          nowMs: Date.now(),
        });
        const nowIsoSnz = new Date().toISOString();
        if (planSnz.consumeReminderIds.length) {
          await supabase.from('task_reminders').update({ sent_at: nowIsoSnz }).in('id', planSnz.consumeReminderIds);
        }
        if (planSnz.insertReminder) {
          await supabase.from('task_reminders').insert({
            task_id: t.id, remind_at: planSnz.insertReminder.remind_at, label: planSnz.insertReminder.label,
          });
        }
        if (planSnz.taskPatch) {
          await supabase.from('tasks').update(planSnz.taskPatch).eq('id', t.id);
        }
        console.log(`[Task] snooze_reminders task=${String(t.id).slice(0, 8)} consumed=${planSnz.consumeReminderIds.length} inserted=${planSnz.insertReminder ? 1 : 0} patch=${planSnz.taskPatch ? 'y' : 'n'} clearAll=${clearAllSnz} not_before=${a.not_before || '(all)'}`);
        okCount++;
```

- [ ] **Step 2: Garantir que `planReminderFloor` está importado**

No topo de `src/engine.js`, a linha 21 é:

```javascript
const { shiftRemindersByReschedule, shiftTaskRemindAt } = require('./services/reschedule-reminders');
```

Trocar por:

```javascript
const { shiftRemindersByReschedule, shiftTaskRemindAt, planReminderFloor } = require('./services/reschedule-reminders');
```

- [ ] **Step 3: Checar sintaxe**

Run: `cd D:\la-organizer\_remote && node --check src/engine.js`
Expected: sem saída, exit 0.

---

## Task 4: Regra na skill `checklist-tarefas.md`

**Files:**
- Modify: `skills/checklist-tarefas.md` (inserir seção nova após o bloco de exemplos de `<<TASK_UPDATE>>`, ~linha 429)

- [ ] **Step 1: Inserir a seção**

Localize o bloco de exemplo de actions (a linha ```` ``` ```` que fecha o exemplo `<<TASK_UPDATE>> [...] <<END>>` perto da linha 429). **Após** esse bloco, insira:

```markdown
## Snooze / silêncio de lembrete (por tarefa)

Quando o usuário pede pra **parar ou atrasar os lembretes de UMA tarefa específica** — "só me lembra às 15h", "para de me lembrar antes das 15h", "não me lembra mais dessa tarefa" — use a action `snooze_reminders` no `<<TASK_UPDATE>>`. **Você CONSEGUE fazer isso.** Nunca diga "vai no app" nem "não dá pra mexer nos lembretes".

- Identifique a tarefa por `title` (ou `id`, se tiver o short-id).
- **"só me lembra às Xh" / "para de me lembrar antes das Xh"** → `not_before` = o horário X em ISO 8601 com fuso `-03:00` (resolva a data igual a um lembrete normal). Isso silencia os lembretes anteriores a X e **mantém** os de depois.
- **"não me lembra mais dessa tarefa" / "desliga os lembretes dela"** (sem horário) → `clear_all: true`.

Isto **não** muda o prazo nem conclui a tarefa — só ajusta os lembretes. Se a pessoa quer mudar o PRAZO, use `reschedule`. Se a tarefa **não tem nenhum lembrete** e ela quer um, use `create`/`reschedule` (snooze só reduz lembretes que já existem).

Exemplos:

```text
// "esses lembretes da reunião tão me enchendo, só me lembra às 15h"
<<TASK_UPDATE>>
[ {"action":"snooze_reminders","title":"reunião","not_before":"2026-06-19T15:00:00-03:00"} ]
<<END>>

// "para de me lembrar dessa tarefa, já entendi"
<<TASK_UPDATE>>
[ {"action":"snooze_reminders","title":"conciliação de cartões","clear_all":true} ]
<<END>>
```

Confirme em linguagem natural, sem jargão: "Beleza — limpei os lembretes dessa tarefa antes das 15h, te chamo só às 15h."
```

- [ ] **Step 2: Verificar que o arquivo continua íntegro**

Run: `cd D:\la-organizer\_remote && node -e "const c=require('fs').readFileSync('skills/checklist-tarefas.md','utf8'); if(!c.includes('snooze_reminders')) process.exit(1); console.log('ok: regra inserida, '+c.length+' chars')"`
Expected: `ok: regra inserida, <N> chars` (e o arquivo deve seguir < 32768 chars — ver SKILL-TRUNCATE-8192/skill-cap; checklist-tarefas hoje é ~23,5KB, há folga).

---

## Task 5: Nota de cross-ref na skill `configurar-preferencias.md`

**Files:**
- Modify: `skills/configurar-preferencias.md` (perto da linha 17, gatilho do `task_checkin_times`)

- [ ] **Step 1: Inserir a nota**

Localize a linha 17:

```markdown
- "tira/desliga o check do meio-dia", "para de me lembrar das tarefas às Xh", "esses check-ins são desnecessários" → `task_checkin_times`
```

**Logo após** ela, insira:

```markdown

> ⚠️ Isto é a grade GLOBAL de check-ins de horário do dia. Silenciar **UMA tarefa específica** ("só me lembra às 15h dessa tarefa", "para de me lembrar dessa tarefa") **não** é preferência — é a action `snooze_reminders` do `<<TASK_UPDATE>>` (ver skill checklist-tarefas).
```

- [ ] **Step 2: Verificar**

Run: `cd D:\la-organizer\_remote && node -e "const c=require('fs').readFileSync('skills/configurar-preferencias.md','utf8'); if(!c.includes('snooze_reminders')) process.exit(1); console.log('ok')"`
Expected: `ok`.

---

## Task 6: E2E na VPS + registro em `tom_known_issues` — ⛔ SÓ APÓS LIBERAR O HOLD

> **Pré-condição:** o Alf removeu `D:\la-organizer\.deploy-hold`. Enquanto o HOLD existir, **pular esta task** (todo o resto é local e seguro).

- [ ] **Step 1: Deploy do engine pra VPS**

```bash
scp D:/la-organizer/_remote/src/services/reschedule-reminders.js tom:/opt/LA-Organizer/src/services/reschedule-reminders.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/skills/checklist-tarefas.md tom:/opt/LA-Organizer/skills/checklist-tarefas.md
scp D:/la-organizer/_remote/skills/configurar-preferencias.md tom:/opt/LA-Organizer/skills/configurar-preferencias.md
ssh tom "pm2 restart tom"
```

- [ ] **Step 2: E2E real na VPS (tarefa descartável)**

Criar um script `scripts/e2e-snooze.js` que (com `node --env-file=.env`, service_role): cria uma task de teste com 4 `task_reminders` (13h/14h/15h/16h hoje), chama o caminho de marker via `applyTaskActions` (ou insere o marker e processa), com `{action:'snooze_reminders', id:<task>, not_before:'<hoje>T15:00:00-03:00'}`, e asserta: os reminders de 13h e 14h ficaram com `sent_at` preenchido, os de 15h/16h seguem `sent_at IS NULL`, nenhum row novo criado. Depois roda o `clear_all` e asserta que todos ficam `sent_at` preenchido. Cleanup ao final (DELETE da task + reminders de teste).

Run: `ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/e2e-snooze.js"`
Expected: `e2e-snooze: N/N passaram`, exit 0.

- [ ] **Step 3: Teste de conversa real (caso Jereh)**

Mandar pro TOM no WhatsApp, numa tarefa com grade de lembretes: "só me lembra às 15h dessa tarefa". Confirmar (logs `pm2 logs tom`) o `[Task] snooze_reminders ... consumed=N` e que o TOM respondeu em linguagem natural (sem dizer "vai no app").

- [ ] **Step 4: Registrar em `tom_known_issues`**

```sql
INSERT INTO tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES (
  'TASK-REMINDER-SNOOZE-NOOP',
  'Pedir "só me lembra às Xh" / "para de me lembrar antes das Xh" para uma tarefa virava só ACK do LLM — a grade de task_reminders seguia disparando antes do horário (caso Jereh)',
  'marker', 'medio', 'corrigido',
  'Não existia ação de snooze/silêncio de lembrete por-tarefa. "Só me lembra às Xh" não tinha marker — o LLM dava ACK e os task_reminders já materializados (grade ~30/30min) seguiam disparando. checkTaskReminders estava correto (respeita DND/quiet com defaultNightGate:false); faltava reorganizar os rows.',
  'Nova action snooze_reminders no TASK_UPDATE: helper puro planReminderFloor (reschedule-reminders.js) faz clear-below-floor (sent_at=now nos rows < not_before) + ensure-one (1 row no piso se a grade foi limpa) + ajuste do one-shot tasks.remind_at; clear_all silencia tudo. Engine via service_role. Skill checklist-tarefas com veto anti-app.',
  'manual', '"so me lembra as", "para de me lembrar antes", "nao me lembra mais dessa tarefa" sem efeito nos lembretes',
  ARRAY['Jereh'], now(), now(), 1, now()
);
```

(Supabase `cesnbnrynvxvgdhfmaua`, via MCP `execute_sql`.)

---

## Self-Review

**Spec coverage:**
- Regra (piso, clear_all, one-shot) → Task 1 (helper) + Task 3 (apply). ✓
- Marker/action `snooze_reminders` + `not_before`/`clear_all` → Task 2 (registro+validação) + Task 3. ✓
- Onde aplica (VALID_TASK_ACTIONS, validateTaskAction, applyTaskActions, reschedule-reminders.js, skills) → Tasks 1-5. ✓
- Diferença do quiet global → Task 5 (cross-ref). ✓
- Edge cases (piso passado, idempotência, stale-past, one-shot disparado) → testes 3/8/2/7 da Task 1. ✓
- Tarefa de grupo "vale pra todos" → Task 3 step 1 (b). ✓
- Restrições (service_role, sem RLS, Balde A intocado, HOLD) → convenções + Task 6 gated. ✓

**Placeholder scan:** sem TBD/TODO; todo step tem código/comando real. ✓

**Type consistency:** `planReminderFloor` retorna `{consumeReminderIds, insertReminder, taskPatch}` — mesmos nomes no teste (Task 1), na implementação (Task 1) e no consumo (Task 3). Campos de `task_reminders` (`id, remind_at, label, sent_at, task_id`) batem com o schema da spec. `not_before`/`clear_all` idênticos em validateTaskAction (Task 2) e applyTaskActions (Task 3). ✓
