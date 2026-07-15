# Staged Reschedule (i) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir reagendamento confirmado de forma determinística — quando o TOM propõe e pergunta ("Tá certo isso?"), o "Isso" seguinte executa via intent estagiado, sem depender do LLM re-emitir o marker.

**Architecture:** O LLM emite TASK_UPDATE com flag `confirm:true` (nível-batch). O engine intercepta, resolve/valida as datas, abre um `pending_intents` kind `reschedule_confirm` com o payload já-resolvido + preview inline engine-generated, e NÃO executa. No turno seguinte, `pendingIntents.detectUserConfirmation` no "Isso" faz o resume determinístico (aplica as actions guardadas). Espelha o padrão `staged_launch` (finance). Rede 1 (chokepoint camada-fraca) já entregue é o teto de dano se a flag não vier.

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase (Postgres), engine.js (bind → catraca).

**STATUS (15/07) — COMPLETO NO AR:** Task 1 ✅ (migration aplicada), 2/2b/3 ✅ (TDD 12/12), **4/5/6 ✅ bind da catraca deployado** (engine.js +66 linhas sobre cópia FRESCA; correções: `detectUserConfirmation` é `'yes'|'no'|null` não `true/false`; catch→cleanText anti-leak; `_metrics.awaiting_user_confirm` no staging), **7 (F2) ✅** (`skills/checklist-tarefas.md` §2 ensina `confirm:true` per-action). md5 VPS==local nos 4 arquivos, restart limpo. Falta só a 1ª observação VIVA (`staged_reschedule:N`→`reschedule_confirm_resolved`) p/ fechar o KI. TTL resume=15min.

## Global Constraints

- `require('./engine')` QUEBRA local → TDD SÓ em helpers puros isolados; engine via `node --check` + suites nos helpers.
- Deploy do `engine.js` é BIND → **catraca** (outro chat), sobre cópia FRESCA da VPS. Retido por `.deploy-hold`.
- Data: resolver na PROPOSTA; payload guarda YMD absoluto; resume NUNCA re-parseia prosa; NUNCA `toISOString().slice(0,10)` (usar o `new_due_date` YMD que o LLM já emite; `todaySP()` p/ hoje).
- Preview: inline estruturado, montado pelo ENGINE a partir do payload resolvido; NUNCA re-narrado pelo LLM.
- Flag `confirm` nível-BATCH (o reagendamento inteiro estagia ou não), nunca por-item.
- Reusar `pendingIntents.detectUserConfirmation` (engine.js:8556) no resume — não inventar matcher.
- Trap A: kind no CHECK do `pending_intents` ANTES de qualquer código (senão `openIntent`→null silencioso).
- Multi-item: 1 intent com N actions; resolução PARCIAL nunca dropa em silêncio (preview pergunta a ambígua).

---

### Task 1: Migration — kind `reschedule_confirm` no CHECK do pending_intents (Trap A, OBRIGATÓRIA PRIMEIRO)

**Files:**
- Create: `migrations/2026-07-15-pending-intents-reschedule-confirm.sql`

**Interfaces:**
- Produces: kind `reschedule_confirm` aceito por `pending_intents.kind` → habilita `openIntent(..., 'reschedule_confirm', ...)` sem retornar null.

- [ ] **Step 1: Confirmar o CHECK atual (baseline)**

Run (Supabase SQL): 
```sql
select pg_get_constraintdef(con.oid) from pg_constraint con
join pg_class rel on rel.oid=con.conrelid
where rel.relname='pending_intents' and con.conname='pending_intents_kind_check';
```
Expected: `CHECK ((kind = ANY (ARRAY['task_creation','event_creation','approval_pending','confirmation','finance_source','invoice_import'])))` (SEM `reschedule_confirm`).

- [ ] **Step 2: Escrever a migration (drop + recreate com o novo kind)**

```sql
-- 2026-07-15 — habilita staged reschedule (i). Trap A: kind no CHECK ANTES do código.
alter table pending_intents drop constraint pending_intents_kind_check;
alter table pending_intents add constraint pending_intents_kind_check
  check (kind = any (array[
    'task_creation','event_creation','approval_pending','confirmation',
    'finance_source','invoice_import','reschedule_confirm'
  ]));
```

- [ ] **Step 3: Aplicar via MCP Supabase (`apply_migration`) e verificar**

Run: aplicar a migration; depois re-rodar o SELECT do Step 1.
Expected: o `def` agora inclui `'reschedule_confirm'`.

- [ ] **Step 4: Smoke — openIntent não retorna null pro novo kind**

Run (Supabase SQL, insert direto simulando openIntent, depois rollback):
```sql
begin;
insert into pending_intents (collaborator_id, kind, payload, question_text)
select id, 'reschedule_confirm', '{}'::jsonb, 'teste' from collaborators limit 1
returning id, kind;
rollback;
```
Expected: 1 row retornada (kind=reschedule_confirm), SEM erro de constraint.

- [ ] **Step 5: Commit**

```bash
git add migrations/2026-07-15-pending-intents-reschedule-confirm.sql
git commit -m "feat(db): pending_intents aceita kind reschedule_confirm (staged reschedule Trap A)"
```

---

### Task 2: Helper puro — normalize + partition das actions (resolução parcial)

**Files:**
- Create: `src/tasks/reschedule-stage.js`
- Test: `src/tasks/reschedule-stage.test.js`

**Interfaces:**
- Produces:
  - `normalizeRescheduleActions(actions: object[]) -> object[]` (aplica aliases due_date→new_due_date, remind_at→new_remind_at)
  - `partitionResolved(actions: object[]) -> { resolved: object[], ambiguous: object[] }` (ambiguous = sem `new_due_date` YMD válido nem `new_remind_at`; cada ambíguo ganha `reason`)

- [ ] **Step 1: Escrever os testes que falham**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeRescheduleActions, partitionResolved } = require('./reschedule-stage');

test('normalize: alias due_date→new_due_date, remind_at→new_remind_at (engine 3617-3620)', () => {
  const [a] = normalizeRescheduleActions([{ action: 'reschedule', id: 't1', due_date: '2026-07-20' }]);
  assert.strictEqual(a.new_due_date, '2026-07-20');
  const [b] = normalizeRescheduleActions([{ action: 'reschedule', id: 't2', remind_at: '2026-07-20T12:00:00Z' }]);
  assert.strictEqual(b.new_remind_at, '2026-07-20T12:00:00Z');
});
test('normalize: não sobrescreve canônico existente', () => {
  const [a] = normalizeRescheduleActions([{ id: 't1', new_due_date: '2026-07-20', due_date: '2026-01-01' }]);
  assert.strictEqual(a.new_due_date, '2026-07-20');
});
test('partition: caso Matheus — 4 datas válidas → todas resolved', () => {
  const acts = [
    { action: 'reschedule', id: 'clinica', new_due_date: '2026-07-15' },
    { action: 'reschedule', id: 'emusys', new_due_date: '2026-07-15' },
    { action: 'reschedule', id: 'curadoria', new_due_date: '2026-07-20' },
    { action: 'reschedule', id: 'transicao', new_due_date: '2026-07-20' },
  ];
  const { resolved, ambiguous } = partitionResolved(acts);
  assert.strictEqual(resolved.length, 4);
  assert.strictEqual(ambiguous.length, 0);
});
test('partition: PARCIAL — 3 resolvem, 1 sem data → 1 ambíguo com reason (nunca dropa)', () => {
  const acts = [
    { action: 'reschedule', id: 'a', new_due_date: '2026-07-15' },
    { action: 'reschedule', id: 'b', new_due_date: '2026-07-20' },
    { action: 'reschedule', id: 'c', new_due_date: '2026-07-20' },
    { action: 'reschedule', id: 'd' }, // sem data
  ];
  const { resolved, ambiguous } = partitionResolved(acts);
  assert.strictEqual(resolved.length, 3);
  assert.strictEqual(ambiguous.length, 1);
  assert.strictEqual(ambiguous[0].id, 'd');
  assert.ok(/data/i.test(ambiguous[0].reason));
});
test('partition: data inválida (não-ISO) → ambíguo', () => {
  const { resolved, ambiguous } = partitionResolved([{ id: 'x', new_due_date: 'segunda' }]);
  assert.strictEqual(resolved.length, 0);
  assert.strictEqual(ambiguous.length, 1);
});
test('partition: só new_remind_at (sem due) → resolved', () => {
  const { resolved } = partitionResolved([{ id: 'x', new_remind_at: '2026-07-20T09:00:00Z' }]);
  assert.strictEqual(resolved.length, 1);
});
```

- [ ] **Step 2: Rodar — deve falhar (módulo não existe)**

Run: `cd _remote && node --test src/tasks/reschedule-stage.test.js`
Expected: FAIL (Cannot find module './reschedule-stage').

- [ ] **Step 3: Implementar o mínimo**

```js
'use strict';
// reschedule-stage.js — staging determinístico de reagendamento (i). PURO.
// Spec: docs/superpowers/specs/2026-07-15-staged-reschedule-design.md
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Aliases que o LLM às vezes emite (espelha engine 3617-3620).
function normalizeRescheduleActions(actions) {
  return (Array.isArray(actions) ? actions : []).map((a) => {
    const o = { ...a };
    if (typeof o.due_date === 'string' && !o.new_due_date) o.new_due_date = o.due_date;
    if (typeof o.remind_at === 'string' && !o.new_remind_at) o.new_remind_at = o.remind_at;
    return o;
  });
}

// Particiona em resolved (data absoluta válida OU remind_at) e ambiguous (nem uma nem outra).
// §9.4/Trap B: o ambíguo NUNCA é dropado — volta pro preview perguntar.
function partitionResolved(actions) {
  const resolved = [], ambiguous = [];
  for (const a of normalizeRescheduleActions(actions)) {
    const hasDate = typeof a.new_due_date === 'string' && ISO_DATE_RE.test(a.new_due_date);
    const hasRemind = typeof a.new_remind_at === 'string' && a.new_remind_at.length >= 10;
    if (hasDate || hasRemind) resolved.push(a);
    else ambiguous.push({ ...a, reason: 'sem data absoluta (new_due_date YYYY-MM-DD)' });
  }
  return { resolved, ambiguous };
}

module.exports = { normalizeRescheduleActions, partitionResolved, ISO_DATE_RE };
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd _remote && node --test src/tasks/reschedule-stage.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/tasks/reschedule-stage.js src/tasks/reschedule-stage.test.js
git commit -m "feat(tasks): reschedule-stage normalize+partition (resolução parcial, TDD)"
```

---

### Task 2b: Guarda de data passada no partition (não estagiar reagendamento pro passado)

**Files:**
- Modify: `src/tasks/reschedule-stage.js`
- Test: `src/tasks/reschedule-stage.test.js`

**Interfaces:**
- Consumes: `partitionResolved` (Task 2)
- Produces: `partitionResolved(actions, { todayYmd })` — se `todayYmd` vier, `new_due_date < todayYmd` cai em ambiguous com `reason` de data-no-passado.

- [ ] **Step 1: Teste que falha**

```js
const { partitionResolved } = require('./reschedule-stage');
test('partition: data no passado vira ambíguo quando todayYmd fornecido', () => {
  const { resolved, ambiguous } = partitionResolved(
    [{ id: 'x', new_due_date: '2026-07-10' }], { todayYmd: '2026-07-15' });
  assert.strictEqual(resolved.length, 0);
  assert.strictEqual(ambiguous.length, 1);
  assert.ok(/passad/i.test(ambiguous[0].reason));
});
test('partition: sem todayYmd não checa passado (retrocompat)', () => {
  const { resolved } = partitionResolved([{ id: 'x', new_due_date: '2020-01-01' }]);
  assert.strictEqual(resolved.length, 1);
});
```

- [ ] **Step 2: Rodar — falha** (`partitionResolved` ignora opts)

Run: `cd _remote && node --test src/tasks/reschedule-stage.test.js`
Expected: FAIL nos 2 novos (o do passado retorna resolved=1).

- [ ] **Step 3: Implementar — adicionar opts.todayYmd**

Substituir a assinatura e o loop de `partitionResolved`:
```js
function partitionResolved(actions, opts = {}) {
  const todayYmd = typeof opts.todayYmd === 'string' && ISO_DATE_RE.test(opts.todayYmd) ? opts.todayYmd : null;
  const resolved = [], ambiguous = [];
  for (const a of normalizeRescheduleActions(actions)) {
    const hasDate = typeof a.new_due_date === 'string' && ISO_DATE_RE.test(a.new_due_date);
    const hasRemind = typeof a.new_remind_at === 'string' && a.new_remind_at.length >= 10;
    if (hasDate && todayYmd && a.new_due_date < todayYmd) {
      ambiguous.push({ ...a, reason: `data no passado (${a.new_due_date} < ${todayYmd})` });
    } else if (hasDate || hasRemind) {
      resolved.push(a);
    } else {
      ambiguous.push({ ...a, reason: 'sem data absoluta (new_due_date YYYY-MM-DD)' });
    }
  }
  return { resolved, ambiguous };
}
```
(Comparação de strings YMD é segura lexicograficamente — mesmo comprimento, zero-padded. Sem tz.)

- [ ] **Step 4: Rodar — passa (todos, incluindo os de Task 2)**

Run: `cd _remote && node --test src/tasks/reschedule-stage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/reschedule-stage.js src/tasks/reschedule-stage.test.js
git commit -m "feat(tasks): reschedule-stage guarda data-no-passado (todayYmd opcional)"
```

---

### Task 3: Preview inline engine-generated (nunca LLM-narrado)

**Files:**
- Modify: `src/tasks/reschedule-stage.js`
- Test: `src/tasks/reschedule-stage.test.js`

**Interfaces:**
- Consumes: `partitionResolved` output
- Produces: `buildReschedulePreview(resolved, ambiguous, titleById = {}) -> string` (datas DD/MM; pergunta a ambígua distinta; "Confirma?" só quando tudo resolveu)

- [ ] **Step 1: Testes que falham**

```js
const { buildReschedulePreview } = require('./reschedule-stage');
test('preview: tudo resolvido → lista + pergunta de confirmação', () => {
  const s = buildReschedulePreview(
    [{ id: 'clinica', new_due_date: '2026-07-15' }, { id: 'curadoria', new_due_date: '2026-07-20' }],
    [], { clinica: 'Atualizar relatórios clínica', curadoria: 'Curadoria professores eMusys' });
  assert.ok(/Atualizar relatórios clínica/.test(s));
  assert.ok(/15\/07/.test(s) && /20\/07/.test(s), 'datas absolutas DD/MM');
  assert.ok(/[Cc]onfirma/.test(s));
});
test('preview: PARCIAL → pergunta a ambígua distinta, sem "Confirma?" cego', () => {
  const s = buildReschedulePreview(
    [{ id: 'a', new_due_date: '2026-07-15' }],
    [{ id: 'd', reason: 'sem data' }], { a: 'Tarefa A', d: 'Tarefa D' });
  assert.ok(/Tarefa A/.test(s) && /15\/07/.test(s));
  assert.ok(/Tarefa D/.test(s), 'a ambígua aparece');
  assert.ok(/[Qq]ual/.test(s), 'pergunta a data da ambígua');
});
test('preview: título ausente cai em fallback com id curto', () => {
  const s = buildReschedulePreview([{ id: 'abcdef123456', new_due_date: '2026-07-15' }], [], {});
  assert.ok(/abcdef12/.test(s));
});
```

- [ ] **Step 2: Rodar — falha**

Run: `cd _remote && node --test src/tasks/reschedule-stage.test.js`
Expected: FAIL (buildReschedulePreview não existe).

- [ ] **Step 3: Implementar**

Adicionar a `reschedule-stage.js` (antes do module.exports):
```js
function _fmtYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}/${m[2]}` : String(ymd || '');
}
// Preview inline ESTRUTURADO montado do payload resolvido — nunca re-narrado pelo LLM (§6).
function buildReschedulePreview(resolved, ambiguous = [], titleById = {}) {
  const name = (id) => titleById[id] || `tarefa ${String(id).slice(0, 8)}`;
  let msg = '';
  if (resolved && resolved.length) {
    const lines = resolved.map((a) => `• *${name(a.id)}* → ${a.new_due_date ? _fmtYmd(a.new_due_date) : String(a.new_remind_at).slice(0, 16)}`);
    msg = `📋 Vou reagendar:\n${lines.join('\n')}`;
  }
  if (ambiguous && ambiguous.length) {
    const amb = ambiguous.map((a) => `• *${name(a.id)}*`).join('\n');
    msg += (msg ? '\n\n' : '') + `❓ Não peguei a data de:\n${amb}\n\nQual data pra essa(s)?`;
  } else if (resolved && resolved.length) {
    msg += '\n\nConfirma? (responde "isso" / "sim")';
  }
  return msg;
}
```
E incluir `buildReschedulePreview` no `module.exports`.

- [ ] **Step 4: Rodar — passa (toda a suite)**

Run: `cd _remote && node --test src/tasks/reschedule-stage.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tasks/reschedule-stage.js src/tasks/reschedule-stage.test.js
git commit -m "feat(tasks): buildReschedulePreview inline engine-generated (parcial pergunta a ambígua)"
```

---

### Task 4: [BIND — catraca] Interceptação no turno da PROPOSTA (estagiar em vez de executar)

**Files:**
- Modify: `_remote/src/engine.js` (parser/executor do TASK_UPDATE; ponto exato confirmado sobre cópia FRESCA da VPS — espelha `staged_launch` em ~11817-11845)

**CORREÇÕES DA CÓPIA FRESCA (catraca):**
- **F1:** NÃO existe `confirm` batch-level — `parseTaskUpdateMarker` (engine 433) retorna `{actions:[...], cleanText, malformed}` sem envelope de flag. Contrato = `confirm` **PER-ACTION**; estagia sse `parsedTask.actions.every(a => a.action==='reschedule' && a.confirm===true)`. Validador tolera a chave extra `confirm`. Preserva "sem batch misto".
- Var real = **`parsedTask`** (não `parsedTU`). Data = **`todayYmdSP()`** de `./utils/dates` (`todaySP()` não existe no escopo).
- **Posição:** entra como **`else if` ANTES do `else if (parsedTask)` de 10307**, **SEM `return`** (seta `reply` e cai no send normal). Apply real fica em 10369 (no ramo genérico, que este `else if` intercepta antes).

**Interfaces:**
- Consumes: `normalizeRescheduleActions`, `partitionResolved`, `buildReschedulePreview` de `./tasks/reschedule-stage`; `todayYmdSP` de `./utils/dates`; `pendingIntents.openIntent(collab.id, 'reschedule_confirm', payload, questionText)`; `logMarker`.
- Produces: um `pending_intents` kind `reschedule_confirm` com `payload.actions` (resolvidas) + `payload.ambiguous`; marker log `TASK_UPDATE skipped staged_reschedule:N`; `reply` = preview engine-generated (sem return → segue pro send).

- [ ] **Step 1: Novo ramo `else if` (per-action confirm) ANTES de 10307, sem return**

```js
// (i) STAGED RESCHEDULE — confirm PER-ACTION (F1): estagia em vez de executar.
// Todas as actions reschedule E todas com confirm:true (sem batch misto).
} else if (parsedTask && Array.isArray(parsedTask.actions) && parsedTask.actions.length > 0
    && parsedTask.actions.every((a) => a.action === 'reschedule' && a.confirm === true)) {
  const { partitionResolved, buildReschedulePreview } = require('./tasks/reschedule-stage');
  const { todayYmdSP } = require('./utils/dates');
  const { resolved, ambiguous } = partitionResolved(parsedTask.actions, { todayYmd: todayYmdSP() });
  const _ids = [...resolved, ...ambiguous].map((a) => a.id);
  const { data: _trows } = await supabase.from('tasks').select('id,title').in('id', _ids);
  const _titleById = Object.fromEntries((_trows || []).map((r) => [r.id, r.title]));
  const _preview = buildReschedulePreview(resolved, ambiguous, _titleById);
  await pendingIntents.openIntent(collab.id, 'reschedule_confirm', { actions: resolved, ambiguous }, _preview);
  await logMarker(collab.id, 'TASK_UPDATE', 'skipped', `staged_reschedule:${resolved.length}`, null);
  reply = _preview;                       // NÃO executa o apply; sem return → cai no send
  _metrics.awaiting_user_confirm = true;  // é pergunta → chokepoint não rebaixa (staging é honesto)
}
```
(Encadeia na cadeia if/else-if existente: `if (malformed) … } else if (<este>) { … } else if (parsedTask) { …apply@10369… }`. A catraca posiciona sobre a cópia fresca.)

- [ ] **Step 2: Validação de sintaxe**

Run: `ssh tom "node --check /opt/LA-Organizer/src/engine.js"` (após aplicar na cópia fresca)
Expected: sem erro.

- [ ] **Step 3: Prova de estágio (log)**

Run (após deploy cirúrgico): simular no WhatsApp de teste um reagendamento com confirm → verificar `marker_logs` `TASK_UPDATE skipped staged_reschedule:N` + 1 row nova em `pending_intents` kind `reschedule_confirm` com `payload.actions`.
Expected: intent aberto, NENHUM `tasks.updated_at` mexido ainda.

- [ ] **Step 4: Commit (bundle da catraca)** — junto com Task 5 no hunk cirúrgico único de bind.

---

### Task 5: [BIND — catraca] Resume no turno da CONFIRMAÇÃO ("Isso" → executa o payload)

**Files:**
- Modify: `_remote/src/engine.js` (handler de confirmação — **região 8551**, idioma do `launch_confirm`; reusa `detectUserConfirmation`)

**Nota (catraca):** `applyTaskActions` tolera a chave extra `confirm` nas actions (validador não rejeita) → `payload.actions` pode ir direto pro apply sem stripar. TTL = **15min** (`withinConfirmWindow(i.asked_at, 15)`).

**Interfaces:**
- Consumes: `pendingIntents.listOpenIntents(collab.id)` (filtrar kind `reschedule_confirm`); `pendingIntents.detectUserConfirmation(text)`; `withinConfirmWindow(asked_at, minutes)` (idioma existente, ex. finance:15); `applyTaskActions(...)` (caminho de execução existente); `pendingIntents.resolveIntent(intentId, resolution)`.
- Produces: no "Isso" → executa `intent.payload.actions` (já-resolvidas) via `applyTaskActions` + `resolveIntent(id,'confirmed')`; no "não"/emenda → `resolveIntent(id,'denied')` e cai no fluxo normal (LLM re-propõe).

- [ ] **Step 1: Bloco de resume (a inserir no dispatch de confirmação)**

```js
// (i) RESUME staged reschedule — "Isso" após proposta estagiada. Determinístico, sem LLM.
const _rsCands = _openIntents.filter((i) => i.kind === 'reschedule_confirm' && withinConfirmWindow(i.asked_at, 15)); // 15min: paridade finance + anti-misbind (nota catraca)
const _rsOpen = _rsCands[0];
if (_rsOpen) {
  const _yn = pendingIntents.detectUserConfirmation(String(text || '')); // reusa matcher tunado
  if (_yn === true) {
    const _acts = (_rsOpen.payload && _rsOpen.payload.actions) || [];
    const _res = await applyTaskActions(collab, _acts);   // caminho de execução REAL, payload já-resolvido
    await pendingIntents.resolveIntent(_rsOpen.id, 'confirmed');
    await logMarker(collab.id, 'TASK_UPDATE', _res.failCount ? 'executed' : 'executed',
      `ok=${_res.okCount} fail=${_res.failCount} (resumed reschedule)`, null);
    // reply = fechamento honesto engine-generated (ok=N; se failCount, cinto honesto)
    return /* saída */;
  }
  if (_yn === false) {                 // "não" → cancela, fluxo normal re-propõe
    await pendingIntents.resolveIntent(_rsOpen.id, 'denied');
    // NÃO return: deixa o LLM tratar a emenda ("não, quarta") re-propondo (re-estagia)
  }
  // _yn === null (ambíguo) → não age; deixa seguir (cinto: intent continua aberto até TTL/expire)
}
```

- [ ] **Step 2: Validação de sintaxe** — `ssh tom "node --check /opt/LA-Organizer/src/engine.js"` → sem erro.

- [ ] **Step 3: E2E do caso Matheus (VPS, pós-deploy)**

Run: no WhatsApp de teste — (a) áudio "reagenda X pra amanhã, Y pra segunda" com confirm → preview estagiado; (b) responder "isso" → verificar `tasks.due_date` movidas + `pending_intents.resolution='confirmed'` + marker `ok=N`; (c) confirmar que NÃO dispara cobrança de atraso depois (as tasks não estão mais vencidas).
Expected: persiste no "Isso"; zero NOOP.

- [ ] **Step 4: E2E negativo** — responder "não, quarta" → intent `denied`, LLM re-propõe com a data nova (re-estagia). Expected: sem persistência da data velha; nova proposta aparece.

- [ ] **Step 5: Commit (bundle catraca, hunk cirúrgico único Task 4+5)**

```bash
# catraca: hunk cirúrgico sobre cópia fresca da VPS, 2 diffs de prova, md5 antes do restart
```

---

### Task 6: [BIND — catraca/Alf] Fiação da Rede 1 (§7) + deploy conjunto libs+wiring

**Files:**
- Modify: `_remote/src/engine.js` (~12503, opts do `enforceNoMarkerHonesty`)
- (libs já entregues: `src/lib/optimistic-confirm.js`, `src/lib/confirm-question.js`)

**Interfaces:**
- Consumes: `hasWeakCompletionClaim, hasCompletionClaim` (`./lib/optimistic-confirm`), `isActionConfirmQuestion` (`./lib/confirm-question`), `_t0` (em escopo, engine 12281).
- Produces: `pendingActionRecent` no opts do `enforceNoMarkerHonesty` → camada fraca do chokepoint ativa.

- [ ] **Step 1: Inserir o cômputo (boundary por timestamp, não limit(1) cru — §7)**

```js
let _pendingActionRecent = false;
try {
  const _np = !_metrics.marker_emitted && !_metrics.auto_retry_succeeded;
  if (_np && hasWeakCompletionClaim(reply) && !hasCompletionClaim(reply)) {
    const _turnStartIso = new Date(_t0).toISOString();
    const { data: _lt } = await supabase.from('conversation_history')
      .select('content').eq('collaborator_id', collab.id).eq('direction','outbound')
      .lt('created_at', _turnStartIso)
      .order('created_at',{ascending:false}).limit(1).maybeSingle();
    _pendingActionRecent = isActionConfirmQuestion(_lt && _lt.content);
  }
} catch (_) {}
```
E passar `pendingActionRecent: _pendingActionRecent` no objeto opts do `enforceNoMarkerHonesty`.

- [ ] **Step 2: Requires no topo do engine** — garantir `hasWeakCompletionClaim, hasCompletionClaim` de `./lib/optimistic-confirm` e `isActionConfirmQuestion` de `./lib/confirm-question`.

- [ ] **Step 3: Syntax + suites das libs**

Run: `ssh tom "node --check /opt/LA-Organizer/src/engine.js"`; `cd _remote && node --test src/lib/optimistic-confirm.test.js src/lib/confirm-question.test.js`
Expected: sem erro; 32 PASS.

- [ ] **Step 4: E2E Rede 1 (VPS)** — turno "confirm-question" → "Isso" → TOM "Fechou" SEM persistir (com o staging desligado por flag, p/ provar o backstop) → verificar reply degradado honesto ("não consegui salvar") + `marker_logs` `CHOKEPOINT redirected confab:task`. Expected: fira honesto; banter "Fechou, valeu!" não fira.

- [ ] **Step 5: Commit (bundle catraca — libs já em disco + hunk §7)**

---

### Task 7: [PROMPT/SKILL — requer OK do Alf] Ensinar o TOM a emitir `confirm:true` (F2 — sem isto, (i) é INERTE)

**Files:**
- Modify: skill de edição/reagendamento de tarefa (candidatas: `skills/lista-mental.md`, `skills/planejamento-semanal.md`, ou `soul/AGENTS.md` — a que documenta o TASK_UPDATE reschedule). Confirmar a dona sobre a cópia fresca.

**Contrato a ensinar (modelo A — mínimo, mecanismo, não mexe na voz):**
> Ao **reagendar** tarefa: se o pedido for **claro e inequívoco** (uma tarefa, data explícita) → emita o `reschedule` normal (executa na hora). Se você **for perguntar "tá certo?"** antes (áudio ambíguo, várias tarefas, data relativa) → emita **cada** action do TASK_UPDATE com `"confirm": true`. O engine estagia e a confirmação do usuário ("isso"/"sim") aplica sozinha — você NÃO reemite o marker depois.

**Por que precisa de OK:** é edição de prompt/skill (comportamento). O risco é o LLM emitir `confirm:true` de menos (inerte) ou demais (fricção). Recomendo: adicionar o bloco + observar em shadow (o staging só liga com a flag; sem ela, comportamento atual intacto). NÃO deployar sem revisão do Alf.

- [ ] **Step 1:** localizar a skill dona do reschedule (grep `reschedule`/`reagend` + `new_due_date` nas skills).
- [ ] **Step 2:** Alf revisa o texto do bloco (tom/gatilho) antes de escrever.
- [ ] **Step 3:** aplicar o bloco aprovado; SCP; observar emissão de `confirm:true` em shadow (marker_logs `staged_reschedule:N` começa a aparecer).

---

## Self-Review

**1. Spec coverage:** (A) modelo → Task 4 (só estagia com confirm). (i) flag+openIntent+resume → Tasks 4-5. Rede 1 → Task 6 (+ libs entregues). Trap A → Task 1 (primeiro). Trap B (data absoluta) → Task 2/2b (YMD, sem toISOString) + Task 4 (todaySP). Preview inline engine-generated → Task 3 + Task 4 (buildReschedulePreview, nunca LLM). Multi-item 1 intent + parcial → Task 2/3 (partition + preview pergunta ambígua). detectUserConfirmation reuse → Task 5. Flag batch-level → Task 4 (`every(a.action==='reschedule')` + `parsedTU.confirm`). ✅ coberto.

**2. Placeholder scan:** helpers puros (Tasks 1-3, 2b) têm código completo + testes. Tasks 4-6 são BIND (catraca) com interfaces exatas e o código a inserir; os `return`/short-circuit finais são explicitamente delegados à catraca por control-flow sobre a cópia fresca (não é placeholder — é a fronteira de deploy documentada).

**3. Type consistency:** `normalizeRescheduleActions`/`partitionResolved(actions, opts)`/`buildReschedulePreview(resolved, ambiguous, titleById)` consistentes entre Tasks 2/2b/3 e o consumo em Task 4. `openIntent(collab.id,'reschedule_confirm',payload,preview)` e `resolveIntent(id,'confirmed'|'denied')` batem com a API real (pending-intents.js). `detectUserConfirmation(text)` retorna true/false/null — tratado nos 3 ramos em Task 5.

## Notas de fronteira (deploy)
- Tasks 1-3 + 2b = MEUS (DB + helpers puros), TDD, retidos por `.deploy-hold`.
- Tasks 4-6 = BIND (`engine.js`) → **catraca**, hunk cirúrgico sobre cópia FRESCA da VPS (2 diffs de prova + md5 antes do restart). Task 1 (migration) DEVE estar aplicada antes de Task 4 ir ao ar (Trap A).
