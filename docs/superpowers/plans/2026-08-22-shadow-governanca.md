# Shadow test na governança — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois que o ciclo de governança marca um finding como corrigido (ou o promove a KI), reproduzir o turno REAL pelo engine+LLM vivo em modo QA e deixar um judge no Codex decidir se o comportamento mudou de verdade — barrando o carimbo quando a sombra reprova.

**Architecture:** Arquitetura A (módulo no gov-runner, mesmo processo). Três unidades puras/isoláveis (`shadow-reproducibility`, `shadow-runner`, `shadow-judge`) orquestradas por `shadow-pass`, chamado pelo `gov-runner` DEPOIS do `rodarCicloGovernanca`. O corretor é o ciclo LLM que marca via SQL; a sombra é um passo determinístico que lê o que o ciclo acabou de marcar e verifica ao vivo. Independência = judge no Codex (modelo ≠ Claude do corretor), não processo separado.

**Tech Stack:** Node.js (CommonJS), Supabase JS, engine QA harness (`turnClaim.runInTurn({qa:true})` + `whatsapp.sendMessage` stub), Codex via `src/ai/openai.js` `chat()`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-22-shadow-governanca-design.md`

## Global Constraints

- **QA-only, sempre:** perfil na faixa `^5500\d{9}$` (`TOM_QA_PHONES`, default `5500000000001`); `whatsapp.sendMessage` stubado no runner (captura, não envia); ReplayLab bloqueia a faixa como 2ª barreira; `created_by` é NOT NULL ao inserir task QA; cleanup por `collaborator_id` no `finally`.
- **`reprovado` é o ÚNICO veredito que barra.** `inconclusivo` e `aprovado` nunca barram (o gate determinístico segue como base).
- **Irreproduzível → `inconclusivo`** (nunca barra). Qualquer erro do runner/judge → `inconclusivo` (freio-mestre; nunca quebra o ciclo de governança).
- **Sem migration em v1:** persiste no `verified_note` do finding (prefixo `[shadow YYYY-MM-DD]`) + marker `SHADOW` em `marker_logs`.
- **Judge = Codex** (`src/ai/openai.js`), papel separado do corretor (Claude). Postura cética: só `reprovado` com evidência no transcript; na dúvida, `inconclusivo`.
- **Nunca cortar em silêncio:** se o teto de custo pular findings, logar quais.
- PT-BR nas falas. Baseline da suíte VPS = fail 3 (loadout). `.deploy-hold` nas duas raízes antes de tocar `src/` que o TOM roda; deploy ritual (SCP + suíte + restart provado + KI + push).

---

### Task 1: `shadow-reproducibility` (puro)

**Files:**
- Create: `src/governance/shadow-reproducibility.js`
- Test: `src/governance/shadow-reproducibility.test.js`

**Interfaces:**
- Produces: `isReproducible(finding) → { ok: boolean, motivo: string }`. `finding` tem `{ category, summary, evidence, incident_at, group_id }`.

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { isReproducible } = require('./shadow-reproducibility');

test('turno curto de confab é reproduzível', () => {
  const r = isReproducible({ category: 'confabulation', summary: 'TOM disse que criou mas nada persistiu', evidence: 'USUÁRIO: cria X\nTOM: ✅ criei', group_id: null });
  assert.strictEqual(r.ok, true);
});
test('finding de grupo NÃO é reproduzível (v1)', () => {
  assert.strictEqual(isReproducible({ category: 'confabulation', group_id: 'g1', evidence: 'x' }).ok, false);
});
test('categoria de cron/multi-turno NÃO é reproduzível', () => {
  assert.strictEqual(isReproducible({ category: 'media_fail', evidence: 'cobrança diária' }).ok, false);
  assert.strictEqual(isReproducible({ category: 'confabulation', evidence: 'fatura parte 1 parte 2 parte 3' }).ok, false);
});
test('sem evidência aferível → não reproduzível', () => {
  for (const v of [null, undefined, {}, { category: 'confabulation' }]) assert.strictEqual(isReproducible(v).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/governance/shadow-reproducibility.test.js`
Expected: FAIL (`Cannot find module './shadow-reproducibility'`).

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
// v1 conservador: só aceita turno curto encenável. Na dúvida, ok:false (a sombra não
// finge cobrir cron/grupo/multi-turno — esses caem no gate determinístico via inconclusivo).
const CATS_OK = new Set(['confabulation', 'dropped_request']);
// Sinais de cenário caro/irreproduzível no texto do finding.
const MULTITURNO_RE = /fatura|parte\s*[1-9]|cruzamento|cobran[çc]a|lote|di[áa]ri[ao]|todos os dias|parcial|em lote|menu.*dup|reply-quote/i;

function isReproducible(finding) {
  const f = finding || {};
  if (f.group_id) return { ok: false, motivo: 'grupo (v1 não encena chat de grupo)' };
  if (!CATS_OK.has(f.category)) return { ok: false, motivo: `categoria ${f.category || '?'} fora do escopo v1` };
  const txt = String(f.evidence || f.summary || '').trim();
  if (!txt) return { ok: false, motivo: 'sem evidência aferível' };
  if (MULTITURNO_RE.test(txt)) return { ok: false, motivo: 'cenário cron/multi-turno' };
  return { ok: true, motivo: 'turno curto encenável' };
}

module.exports = { isReproducible };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/governance/shadow-reproducibility.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/governance/shadow-reproducibility.js src/governance/shadow-reproducibility.test.js
git commit -m "feat(gov-shadow): isReproducible classifica finding encenável (v1 turno curto)"
```

---

### Task 2: `shadow-judge` (Codex, papel separado)

**Files:**
- Create: `src/governance/shadow-judge.js`
- Test: `src/governance/shadow-judge.test.js`

**Interfaces:**
- Consumes: `openai.chat(systemPrompt, messages) → string` (de `src/ai/openai.js`) — injetado como dep pra testar.
- Produces: `async judgeShadow({ finding, fixIntent, transcript }, { chat }) → { verdict: 'aprovado'|'reprovado'|'inconclusivo', reason: string }`. `transcript = { turns: [{ userText, reply, markers, persisted }] }`.

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { judgeShadow, parseVeredito, buildJudgePrompt } = require('./shadow-judge');

const transcript = { turns: [{ userText: 'me lembra todo dia de X', reply: '✅ lembrete diário ativado', markers: ['PREFS_UPDATE:executed'], persisted: { habito: null } }] };

test('parseVeredito lê o JSON do judge e normaliza', () => {
  assert.deepStrictEqual(parseVeredito('{"verdict":"reprovado","reason":"confabulou"}'), { verdict: 'reprovado', reason: 'confabulou' });
});
test('parseVeredito degrada pra inconclusivo em lixo', () => {
  assert.strictEqual(parseVeredito('bla bla').verdict, 'inconclusivo');
  assert.strictEqual(parseVeredito('{"verdict":"talvez"}').verdict, 'inconclusivo');
});
test('buildJudgePrompt inclui o bug, a intenção do fix e o transcript', () => {
  const p = buildJudgePrompt({ finding: { summary: 'confab X' }, fixIntent: 'não afirmar sem persistir', transcript });
  assert.match(p, /confab X/); assert.match(p, /não afirmar sem persistir/); assert.match(p, /PREFS_UPDATE/);
});
test('judgeShadow devolve o veredito do chat (Codex mockado)', async () => {
  const chat = async () => '{"verdict":"reprovado","reason":"disse lembrete ativado sem persistir"}';
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript }, { chat });
  assert.strictEqual(r.verdict, 'reprovado');
});
test('erro no chat → inconclusivo (freio-mestre)', async () => {
  const chat = async () => { throw new Error('codex down'); };
  const r = await judgeShadow({ finding: { summary: 'x' }, fixIntent: 'y', transcript }, { chat });
  assert.strictEqual(r.verdict, 'inconclusivo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/governance/shadow-judge.test.js`
Expected: FAIL (module não existe).

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
// Judge da sombra: roda no Codex (modelo != Claude do corretor) e NÃO é o corretor.
// Cético: só 'reprovado' com evidência; na dúvida, 'inconclusivo'.
const VALIDOS = new Set(['aprovado', 'reprovado', 'inconclusivo']);

function buildJudgePrompt({ finding, fixIntent, transcript }) {
  const turns = (transcript && transcript.turns || []).map((t, i) =>
    `Turno ${i + 1}:\n  usuário: ${t.userText}\n  TOM respondeu: ${t.reply}\n  markers: ${(t.markers || []).join(', ') || '(nenhum)'}\n  persistiu: ${JSON.stringify(t.persisted || {})}`
  ).join('\n');
  return [
    'Você é um JUIZ independente de comportamento do agente TOM. NÃO é quem corrigiu.',
    'O BUG relatado era:', String(finding && finding.summary || ''),
    'O FIX deveria fazer:', String(fixIntent || '(não informado)'),
    'O TOM foi reproduzido AO VIVO e produziu:', turns,
    'Pergunta: o comportamento observado é o CORRIGIDO, ou ainda é o BUG?',
    'Regra: só responda "reprovado" se o transcript MOSTRAR o bug (ex.: afirma ação feita sem marker de domínio que persista). Na menor dúvida, "inconclusivo".',
    'Responda SÓ um JSON: {"verdict":"aprovado|reprovado|inconclusivo","reason":"curto"}',
  ].join('\n\n');
}

function parseVeredito(texto) {
  try {
    const m = String(texto).match(/\{[\s\S]*\}/);
    const o = JSON.parse(m ? m[0] : texto);
    if (o && VALIDOS.has(o.verdict)) return { verdict: o.verdict, reason: String(o.reason || '').slice(0, 300) };
  } catch (_) { /* cai no inconclusivo */ }
  return { verdict: 'inconclusivo', reason: 'veredito ilegível do judge' };
}

async function judgeShadow({ finding, fixIntent, transcript }, deps = {}) {
  const chat = deps.chat || require('../ai/openai').chat;
  try {
    const out = await chat('Juiz de comportamento — responda só JSON.', [{ role: 'user', content: buildJudgePrompt({ finding, fixIntent, transcript }) }]);
    return parseVeredito(out);
  } catch (e) {
    return { verdict: 'inconclusivo', reason: `judge falhou: ${String(e.message).slice(0, 80)}` };
  }
}

module.exports = { judgeShadow, parseVeredito, buildJudgePrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/governance/shadow-judge.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/governance/shadow-judge.js src/governance/shadow-judge.test.js
git commit -m "feat(gov-shadow): judge no Codex (papel separado, cético, inconclusivo na dúvida)"
```

---

### Task 3: `shadow-runner` (determinístico, deps injetadas)

**Files:**
- Create: `src/governance/shadow-runner.js`
- Test: `src/governance/shadow-runner.test.js`

**Interfaces:**
- Consumes: deps `{ supabase, engine, whatsapp, turnClaim, qaPhone }`. `derivarCenario(finding) → { setup, turns }` interno.
- Produces: `async runShadow(finding, deps) → { transcript: { turns:[{userText,reply,markers,persisted}] }, erro: string|null }`. Cleanup SEMPRE (finally).

- [ ] **Step 1: Write the failing test** (deps fakes — sem tocar DB/engine real)

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { runShadow, derivarCenario } = require('./shadow-runner');

function fakes() {
  const cleaned = [];
  const qa = { id: 'qa1', phone: '5500000000001' };
  const supabase = {
    from(tbl) { return {
      select(){ return this; }, eq(){ return this; }, ilike(){ return this; }, gte(){ return this; }, is(){ return this; }, not(){ return this; }, order(){ return this; },
      maybeSingle: async () => ({ data: tbl === 'collaborators' ? qa : null }),
      insert(){ return { select(){ return { single: async () => ({ data: { id: 'tk1' } }) }; } }; },
      delete(){ cleaned.push(tbl); return { eq: async () => ({}), in: async () => ({}) }; },
      then(r){ return Promise.resolve({ data: [] }).then(r); },
    }; },
  };
  const sent = [];
  const whatsapp = { sendMessage: async (_p, m) => { sent.push(m); return { key:{id:'x'} }; } };
  const engine = { processMessage: async (_p, _t) => { await whatsapp.sendMessage(_p, '✅ feito'); } };
  const turnClaim = { runInTurn: async (_o, fn) => fn() };
  return { supabase, engine, whatsapp, turnClaim, qaPhone: '5500000000001', _cleaned: cleaned, _sent: sent };
}

test('derivarCenario extrai a fala do usuário do evidence', () => {
  const c = derivarCenario({ category: 'dropped_request', evidence: 'USUÁRIO: lança o que falta\nTOM: não consigo' });
  assert.ok(c.turns.length >= 1);
  assert.match(c.turns[0].userText, /lança o que falta/);
});

test('runShadow captura reply e SEMPRE limpa o QA (finally)', async () => {
  const d = fakes();
  const r = await runShadow({ category: 'dropped_request', evidence: 'USUÁRIO: oi\nTOM: x' }, d);
  assert.ok(r.transcript.turns[0].reply.includes('feito'));
  assert.ok(d._cleaned.length > 0, 'cleanup rodou');
});

test('runShadow limpa mesmo se o engine estoura', async () => {
  const d = fakes();
  d.engine.processMessage = async () => { throw new Error('boom'); };
  const r = await runShadow({ category: 'dropped_request', evidence: 'USUÁRIO: oi\nTOM: x' }, d);
  assert.ok(d._cleaned.length > 0, 'cleanup rodou mesmo com erro');
  assert.ok(r.erro || r.transcript);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/governance/shadow-runner.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
// Runner determinístico da sombra. Encena estado QA descartável, roda o turno real pelo
// engine em modo QA (sendMessage stubado pelo caller de produção; aqui as deps são injetadas),
// captura reply+markers+persistido e LIMPA sempre. Sem modelo.
const FAIXA_QA = /^5500\d{9}$/;

// v1: a fala do usuário sai do evidence ("USUÁRIO: ..."). Cenários mais ricos entram depois.
function derivarCenario(finding) {
  const ev = String((finding && finding.evidence) || '');
  const falas = ev.split('\n').map((l) => l.match(/^\s*USU[ÁA]RIO\s*:\s*(.+)$/i)).filter(Boolean).map((m) => m[1].trim());
  const turns = (falas.length ? falas : [String((finding && finding.summary) || '').slice(0, 200)]).map((userText) => ({ userText }));
  return { setup: {}, turns };
}

async function runShadow(finding, deps = {}) {
  const { supabase, engine, whatsapp, turnClaim, qaPhone } = deps;
  if (!FAIXA_QA.test(String(qaPhone || ''))) return { transcript: { turns: [] }, erro: 'qaPhone fora da faixa' };
  const { data: qa } = await supabase.from('collaborators').select('id, phone').eq('phone', qaPhone).maybeSingle();
  if (!qa) return { transcript: { turns: [] }, erro: 'perfil QA inexistente' };
  const cenario = derivarCenario(finding);
  const turns = [];
  let erro = null;
  try {
    for (const t of cenario.turns) {
      const t0 = Date.now();
      let reply = '';
      const origSend = whatsapp.sendMessage;
      whatsapp.sendMessage = async (_p, m) => { reply += (reply ? ' | ' : '') + String(m); return { key: { id: 'shadow' } }; };
      try {
        await turnClaim.runInTurn({ waMessageId: 'shadow-' + t0, qa: true, runId: 'shadow-' + t0 }, async () => {
          try { await engine.processMessage(qa.phone, t.userText, {}); }
          catch (e) { if (!/destino proibido|status=none/i.test(String(e && e.message))) throw e; }
        });
      } finally { whatsapp.sendMessage = origSend; }
      const { data: mk } = await supabase.from('marker_logs').select('marker_type, result')
        .eq('collaborator_id', qa.id).gte('created_at', new Date(t0 - 1500).toISOString());
      turns.push({ userText: t.userText, reply, markers: (mk || []).map((m) => `${m.marker_type}:${m.result}`), persisted: {} });
    }
  } catch (e) {
    erro = String(e.message).slice(0, 120);
  } finally {
    for (const tbl of ['conversation_history', 'marker_logs', 'pending_intents', 'habits', 'tasks']) {
      try { await supabase.from(tbl).delete().eq('collaborator_id', qa.id); } catch (_) { /* best-effort */ }
    }
  }
  return { transcript: { turns }, erro };
}

module.exports = { runShadow, derivarCenario };
```

> NOTA ao implementador: em PRODUÇÃO o `whatsapp` e `engine` são os módulos reais; o stub
> de `sendMessage` local (acima) é a captura. O cleanup de `habits`/`tasks` por
> `collaborator_id` é suficiente no QA; se um cenário criar `habit_reminders`, apagar por
> `habit_id` antes (buscar ids dos habits QA) — adicionar quando um cenário exigir.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/governance/shadow-runner.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/governance/shadow-runner.js src/governance/shadow-runner.test.js
git commit -m "feat(gov-shadow): runner determinístico (encena QA, roda turno real, cleanup no finally)"
```

---

### Task 4: `shadow-pass` (orquestrador: repro → run → judge → aplica veredito)

**Files:**
- Create: `src/governance/shadow-pass.js`
- Test: `src/governance/shadow-pass.test.js`

**Interfaces:**
- Consumes: `isReproducible` (T1), `runShadow` (T3), `judgeShadow` (T2) — injetáveis; `supabase`.
- Produces: `async shadowPass(findings, deps) → [{ id, verdict, barrou: boolean }]`. Para cada finding: irreproduzível → `inconclusivo` (não barra); senão run+judge; `reprovado` → **reabre** o finding (`status='novo'`, limpa `verified_result`), grava evidência no `verified_note` (`[shadow]`), loga marker `SHADOW`. `aprovado`/`inconclusivo` → só anota + marker.

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { shadowPass } = require('./shadow-pass');

function deps(overrides = {}) {
  const updates = []; const markers = [];
  const supabase = { from(tbl) { return {
    update(patch){ return { eq: async (c, v) => { updates.push({ tbl, patch, id: v }); return {}; } }; },
    insert: async (row) => { markers.push(row); return {}; },
  }; } };
  return Object.assign({
    supabase,
    isReproducible: () => ({ ok: true, motivo: 'ok' }),
    runShadow: async () => ({ transcript: { turns: [{ userText: 'x', reply: '✅ ativado', markers: ['PREFS_UPDATE:executed'], persisted: {} }] }, erro: null }),
    judgeShadow: async () => ({ verdict: 'reprovado', reason: 'confabulou' }),
    _updates: updates, _markers: markers,
  }, overrides);
}

test('reprovado reabre o finding e barra', async () => {
  const d = deps();
  const out = await shadowPass([{ id: 'f1', summary: 'x', fix_intent: 'y' }], d);
  assert.strictEqual(out[0].verdict, 'reprovado');
  assert.strictEqual(out[0].barrou, true);
  const reopen = d._updates.find((u) => u.tbl === 'tom_audit_findings' && u.patch.status === 'novo');
  assert.ok(reopen, 'finding reaberto');
});
test('irreproduzível → inconclusivo, NÃO barra, não roda judge', async () => {
  let judged = false;
  const d = deps({ isReproducible: () => ({ ok: false, motivo: 'grupo' }), judgeShadow: async () => { judged = true; return { verdict: 'reprovado' }; } });
  const out = await shadowPass([{ id: 'f1' }], d);
  assert.strictEqual(out[0].verdict, 'inconclusivo');
  assert.strictEqual(out[0].barrou, false);
  assert.strictEqual(judged, false, 'judge não roda em irreproduzível');
});
test('aprovado não barra e não reabre', async () => {
  const d = deps({ judgeShadow: async () => ({ verdict: 'aprovado', reason: 'ok' }) });
  const out = await shadowPass([{ id: 'f1' }], d);
  assert.strictEqual(out[0].barrou, false);
  assert.ok(!d._updates.some((u) => u.patch && u.patch.status === 'novo'), 'não reabriu');
});
test('erro do runner → inconclusivo (não barra)', async () => {
  const d = deps({ runShadow: async () => ({ transcript: { turns: [] }, erro: 'boom' }) });
  const out = await shadowPass([{ id: 'f1' }], d);
  assert.strictEqual(out[0].verdict, 'inconclusivo');
  assert.strictEqual(out[0].barrou, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/governance/shadow-pass.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
// Orquestra a sombra sobre os findings que o ciclo acabou de fixar/promover. Único ponto que
// APLICA o veredito. reprovado = reabre + barra; inconclusivo/aprovado = anota.
function ymdUtc() { return new Date().toISOString().slice(0, 10); }

async function shadowPass(findings, deps = {}) {
  const { supabase, isReproducible, runShadow, judgeShadow } = deps;
  const out = [];
  for (const f of (findings || [])) {
    let verdict = 'inconclusivo'; let reason = ''; let evidencia = '';
    const rep = isReproducible(f);
    if (!rep.ok) {
      reason = `não reproduzível: ${rep.motivo}`;
    } else {
      const { transcript, erro } = await runShadow(f, deps);
      if (erro) { reason = `runner: ${erro}`; }
      else {
        const j = await judgeShadow({ finding: f, fixIntent: f.fix_intent, transcript }, deps);
        verdict = j.verdict; reason = j.reason || '';
        evidencia = (transcript.turns || []).map((t) => `«${t.userText}» → «${t.reply}» [${(t.markers || []).join(',')}]`).join(' ; ').slice(0, 500);
      }
    }
    const barrou = verdict === 'reprovado';
    const nota = `[shadow ${ymdUtc()}] ${verdict}: ${reason}${evidencia ? ' | ' + evidencia : ''}`;
    try {
      if (barrou) {
        await supabase.from('tom_audit_findings').update({ status: 'novo', verified_result: null, verified_note: nota }).eq('id', f.id);
      } else {
        await supabase.from('tom_audit_findings').update({ verified_note: nota }).eq('id', f.id);
      }
      await supabase.from('marker_logs').insert({ marker_type: 'SHADOW', result: verdict, reason: reason.slice(0, 120) });
    } catch (_) { /* persistência best-effort; nunca derruba o ciclo */ }
    out.push({ id: f.id, verdict, barrou });
  }
  return out;
}

module.exports = { shadowPass };
```

> NOTA: `marker_logs.insert` sem `collaborator_id` pode violar NOT-NULL — na integração (T5)
> passar o id do próprio agente/gov ou o QA id; o teste mocka o insert. Confirmar a coluna
> obrigatória ao integrar e ajustar o insert (não é bloqueante pro contrato do orquestrador).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/governance/shadow-pass.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/governance/shadow-pass.js src/governance/shadow-pass.test.js
git commit -m "feat(gov-shadow): orquestrador repro→run→judge; reprovado reabre+barra, resto anota"
```

---

### Task 5: Integração no `gov-runner` + catraca de fonte

**Files:**
- Modify: `src/rituals/gov-runner.js` (depois do `rodarCicloGovernanca`, antes do restart/pós-processamento)
- Create: `src/governance/shadow-integration.test.js`

**Interfaces:**
- Consumes: `shadowPass` (T4), `openai.chat` (Codex), engine/whatsapp/turnClaim reais.
- Produces: no `gov-runner`, coleta os findings marcados `corrigido`/promovidos NESTE ciclo e chama `shadowPass` com as deps reais (`isReproducible`, `runShadow`, `judgeShadow`), best-effort (try/catch — nunca quebra o ciclo).

- [ ] **Step 1: Write the failing test** (catraca de fonte — o gov-runner tem que chamar a sombra)

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'rituals', 'gov-runner.js'), 'utf8');

test('gov-runner chama shadowPass depois do ciclo', () => {
  assert.match(SRC, /require\('\.\.\/governance\/shadow-pass'\)/);
  assert.match(SRC, /shadowPass\(/);
});
test('gov-runner injeta as 3 unidades + Codex como judge', () => {
  assert.match(SRC, /isReproducible/);
  assert.match(SRC, /runShadow/);
  assert.match(SRC, /judgeShadow/);
  assert.match(SRC, /require\('\.\.\/ai\/openai'\)/);
});
test('a chamada da sombra é best-effort (try/catch, não quebra o ciclo)', () => {
  assert.match(SRC, /\[Shadow\][\s\S]{0,200}?catch/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/governance/shadow-integration.test.js`
Expected: FAIL (gov-runner ainda não referencia shadow-pass).

- [ ] **Step 3: Write minimal implementation** (inserir no `gov-runner.js`, após o ciclo marcar corrigidos/promovidos)

```js
// ── SHADOW (sonda-viva): verifica ao vivo o que o ciclo acabou de marcar ────────────
// Freio-mestre: best-effort — qualquer erro aqui NUNCA quebra o ciclo de governança.
try {
  const { shadowPass } = require('../governance/shadow-pass');
  const { isReproducible } = require('../governance/shadow-reproducibility');
  const { runShadow } = require('../governance/shadow-runner');
  const { judgeShadow } = require('../governance/shadow-judge');
  const engine = require('../engine');
  const whatsapp = require('../services/whatsapp');
  const turnClaim = require('../services/turn-claim');
  const chat = require('../ai/openai').chat;
  const qaPhone = (process.env.TOM_QA_PHONES || '5500000000001').split(',')[0].trim();

  // findings marcados corrigidos/promovidos NESTE ciclo (janela = início do ciclo)
  const { data: alvos } = await supabase.from('tom_audit_findings')
    .select('id, summary, evidence, category, group_id, promoted_code, verified_note')
    .eq('verified_result', 'confirmado').eq('status', 'corrigido')
    .gte('verified_at', cicloInicioIso).limit(10);

  if (alvos && alvos.length) {
    const comIntent = alvos.map((f) => ({ ...f, fix_intent: f.verified_note || f.summary }));
    const res = await shadowPass(comIntent, {
      supabase, isReproducible, runShadow, judgeShadow,
      engine, whatsapp, turnClaim, qaPhone, chat,
    });
    const barrados = res.filter((r) => r.barrou);
    console.log(`[Shadow] ${res.length} verificados, ${barrados.length} reprovados (reabertos)`);
  }
} catch (e) {
  console.error('[Shadow] passe falhou (não quebra o ciclo):', e.message);
}
```

> NOTA ao implementador: `cicloInicioIso` já existe no escopo do gov-runner como marco do
> ciclo (ver [[project_confere_fonte_precisa_escopar_no_claim]] — `cicloInicio` é floor). Se o
> nome local diferir, usar o marco de início do ciclo existente. `judgeShadow`/`runShadow`
> recebem as deps via o mesmo objeto (o `shadow-pass` repassa `deps` ao `runShadow`).
> Confirmar a coluna obrigatória de `marker_logs` e passar `collaborator_id` (QA id) no insert
> do marker `SHADOW` dentro do `shadow-pass` (ajuste do T4).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/governance/shadow-integration.test.js`
Expected: PASS (3 tests). Rodar também `node --check src/rituals/gov-runner.js`.

- [ ] **Step 5: Commit**

```bash
git add src/rituals/gov-runner.js src/governance/shadow-integration.test.js
git commit -m "feat(gov-shadow): gov-runner roda a sonda-viva pós-ciclo (best-effort, judge Codex)"
```

---

### Task 6: Validação viva + deploy + KI

**Files:**
- Modify: (nenhum de código — validação e deploy)

**Interfaces:**
- Consome tudo acima. Prova contra o confab real `bad1c55e` (PREFS_UPDATE) + registra KI.

- [ ] **Step 1: Suíte local + VPS**

Run local: `node --test src/governance/`
Run VPS (após SCP): `ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && set +a && node --test src/ 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: fail 3 = baseline.

- [ ] **Step 2: `.deploy-hold` nas duas raízes + SCP dos arquivos novos**

```bash
echo "shadow-governanca $(date -u +%FT%TZ)" | tee /d/la-organizer/.deploy-hold /d/la-organizer/_remote/.deploy-hold
scp src/governance/*.js tom:/opt/LA-Organizer/src/governance/
scp src/rituals/gov-runner.js tom:/opt/LA-Organizer/src/rituals/gov-runner.js
```

- [ ] **Step 3: Prova viva contra o finding `bad1c55e`** (o confab do PREFS_UPDATE que a sombra existe pra pegar)

Rodar um probe na VPS que chama `runShadow` + `judgeShadow` no finding `bad1c55e` (perfil QA, cleanup) e conferir: quando o LLM confabula, `verdict === 'reprovado'`; o finding fica `status='novo'`. Se `inconclusivo` por variância, rodar 2–3x e registrar a taxa (a sombra é probabilística por natureza do LLM — documentar, não mascarar).

- [ ] **Step 4: Restart provado + baseline**

```bash
ssh tom "pm2 restart tom >/dev/null 2>&1; sleep 8; pm2 describe tom | grep -E 'restarts '; curl -s -o /dev/null -w 'health:3100=%{http_code}\n' http://localhost:3100/health"
```
Expected: restart +1, health 200 na 3100 (NUNCA 3000 — [[project_tom_porta_3100_health_3000_e_a_sol]]).

- [ ] **Step 5: KI + commit + push + sync + holds off + memória**

Registrar KI `GOV-SHADOW-SONDA-VIVA` (sinal_tipo `marker_log`), commit bundle, `git rebase origin/main`, push, `git pull --ff-only` na VPS (NUNCA `git stash -u` — [[project_git_stash_u_apaga_untracked_da_vps]]), remover holds, escrever memória do subsistema.

---

## Self-Review

**1. Spec coverage:** reproducibility (T1) ✓ · runner determinístico+cleanup (T3) ✓ · judge Codex separado (T2) ✓ · orquestrador com veredito barra/anota (T4) ✓ · integração 2-pontos — parcial: o v1 pluga no ponto "pós-fix/corrigido"; a **promoção a KI** compartilha o mesmo passe (o ciclo marca corrigido ao promover), coberto pela mesma query de alvos; se a promoção virar um ponto distinto no futuro, é outra chamada do mesmo `shadowPass`. · ledger `verified_note`+marker `SHADOW`, sem migration ✓ · freios (inconclusivo nunca barra, erro→inconclusivo, QA-only, cleanup finally, custo com limit 10 + log) ✓.

**2. Placeholder scan:** sem TBD/TODO; todo passo tem código real. As duas "NOTA ao implementador" são decisões de integração concretas (nome de var local, coluna NOT-NULL), não placeholders de lógica.

**3. Type consistency:** `isReproducible → {ok,motivo}` (T1) usado em T4 ✓ · `runShadow → {transcript,erro}` (T3) usado em T4 ✓ · `judgeShadow({finding,fixIntent,transcript},deps) → {verdict,reason}` (T2) usado em T4 ✓ · `shadowPass(findings,deps) → [{id,verdict,barrou}]` (T4) usado em T5 ✓ · `verdict ∈ {aprovado,reprovado,inconclusivo}` consistente em T2/T4.

**Gap anotado (não bloqueante):** `derivarCenario` v1 só extrai fala única do `evidence`; cenários que exigem estado encenado (criar a tarefa QA antes) entram quando o primeiro finding desse tipo aparecer — a `reproducibility` já barra o que não dá pra encenar, então nunca roda cego.
