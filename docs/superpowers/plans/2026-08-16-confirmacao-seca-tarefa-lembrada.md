# Confirmação seca → tarefa recém-lembrada — Plano de Implementação (Fatia 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o usuário responde uma confirmação seca ("Feito") até 24h após o TOM lembrar de uma tarefa, concluir a tarefa recém-lembrada de forma determinística (pelo `ref_id` exato), sem chute de título — deixando o LLM só escrever a confirmação na voz do TOM.

**Architecture:** Resolvedor PURO (`completion-from-reminder.js`, padrão do `task-target.js`) decide o alvo a partir das referências de tarefa que o `sendAndLink` já grava em `conversation_history` (`ref_type='task'`). Um trecho no engine, ANTES do `buildSystemPrompt`, busca essas refs, chama o resolvedor, executa a conclusão por id exato via `applyTaskActions`, injeta uma dica de voz no `systemPrompt` e — só no sucesso real — suprime a Camada-1 anti-confab (`enforceNoMarkerHonesty`).

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase JS, o engine existente (`src/engine.js`), Replay Lab (webhook HMAC contra instância efêmera).

## Global Constraints

- **Freio 1:** resolver SÓ confirmação seca após lembrete de tarefa com `ref_type='task'` nas últimas **24h**.
- **Freio 2:** >1 `task_id` DISTINTO lembrado na janela → PERGUNTA qual; **NUNCA** escolhe por recência. (teste obrigatório)
- **Freio 3:** executar conclusão por `taskId` **exato**, sem title-lookup/fuzzy (passar `action.id` pula o title-lookup em `engine.js:4473`).
- **Freio 4:** suprimir `enforceNoMarkerHonesty` **SÓ** se a conclusão determinística retornou sucesso OU idempotência real ("já estava concluída"). Falhou → NÃO suprime. (teste obrigatório)
- **Freio 5:** query de refs falha → degrada pro fluxo atual (nunca quebra o turno).
- **Freio 6:** Replay: lembrete → "feito" solto → tarefa `done`, sem `all_failed`, sem "não consegui registrar", resposta na voz do TOM.
- **Voz do TOM é sagrada:** o engine resolve/executa o ALVO; a fala final é do LLM. Sem template robótico.
- **Baseline da suíte:** `node --env-file=.env --test src/` → `2740+ testes, fail 3`. Sem `--env-file` → `fail 4` (as 3 de `system-loadout` viram 4). Os dois são baselines válidos de comandos DIFERENTES.
- **`engine.js` é COMPARTILHADO com outro chat:** `.deploy-hold` na raiz E em `_remote/` ANTES de editar `src/`; `md5sum` local × VPS antes de `pm2 restart tom`; `ps -o lstart=` prova o restart.
- **Bash = git-bash:** rodar de `cd /d/la-organizer/_remote`; `node --test "src/**/*.test.js"` (o glob não expande sozinho no Windows).

---

### Task 1: Resolvedor puro `completion-from-reminder.js`

**Files:**
- Create: `src/lib/completion-from-reminder.js`
- Test: `src/lib/completion-from-reminder.test.js`

**Interfaces:**
- Consumes: nada (puro).
- Produces:
  - `resolverConclusaoDeLembrete({ reply: string, refsRecentes: Array<{task_id, title, reminded_at}>, agoraMs: number }) → { modo: 'exato', taskId, title, motivo } | { modo: 'ambiguo', candidatos: Array<{taskId,title}>, motivo } | { modo: 'nenhum', motivo }`
  - `ehConclusaoInequivoca(reply: string) → boolean`
  - `JANELA_MS: number` (= 24*3600*1000)

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/completion-from-reminder.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolverConclusaoDeLembrete } = require('./completion-from-reminder');

const AGORA = Date.parse('2026-08-16T18:00:00Z');
const ref = (task_id, title, hAtras) => ({ task_id, title, reminded_at: new Date(AGORA - hAtras*3600*1000).toISOString() });

// Caso central: 1 tarefa lembrada há 3h + "feito" solto → resolve exato por id.
test('1 lembrada na janela + "feito" → exato', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: [ref('t1','Remédios',3)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'exato');
  assert.strictEqual(r.taskId, 't1');
});

// FREIO 2 (obrigatório): 2 tarefas DISTINTAS lembradas → pergunta, NUNCA por recência.
test('2 tarefas distintas na janela → ambiguo (nunca a mais recente)', () => {
  const r = resolverConclusaoDeLembrete({
    reply: 'feito',
    refsRecentes: [ref('t1','Remédios',1), ref('t2','Bombinha',5)],
    agoraMs: AGORA,
  });
  assert.strictEqual(r.modo, 'ambiguo');
  assert.strictEqual(r.candidatos.length, 2);
});

// Dedup do MESMO id (lembrete repetido) NÃO é ambiguidade.
test('mesmo task_id lembrado 2x → exato (dedup, não ambiguo)', () => {
  const r = resolverConclusaoDeLembrete({
    reply: 'pronto', refsRecentes: [ref('t1','Remédios',1), ref('t1','Remédios',10)], agoraMs: AGORA,
  });
  assert.strictEqual(r.modo, 'exato');
  assert.strictEqual(r.taskId, 't1');
});

test('negação "não fiz" → nenhum (jamais completa contra negação)', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'não fiz ainda', refsRecentes: [ref('t1','x',1)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'nenhum');
});

test('pergunta "feito?" → nenhum', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'já era pra estar feito?', refsRecentes: [ref('t1','x',1)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'nenhum');
});

test('fora da janela de 24h → nenhum', () => {
  const r = resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: [ref('t1','x',30)], agoraMs: AGORA });
  assert.strictEqual(r.modo, 'nenhum');
});

test('sem refs → nenhum', () => {
  assert.strictEqual(resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: [], agoraMs: AGORA }).modo, 'nenhum');
});

test('reply que não é conclusão ("valeu") → nenhum', () => {
  assert.strictEqual(resolverConclusaoDeLembrete({ reply: 'valeu, tom', refsRecentes: [ref('t1','x',1)], agoraMs: AGORA }).modo, 'nenhum');
});

test('entrada degenerada não quebra', () => {
  assert.strictEqual(resolverConclusaoDeLembrete({}).modo, 'nenhum');
  assert.strictEqual(resolverConclusaoDeLembrete({ reply: 'feito', refsRecentes: null, agoraMs: AGORA }).modo, 'nenhum');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /d/la-organizer/_remote && node --test src/lib/completion-from-reminder.test.js`
Expected: FAIL — `Cannot find module './completion-from-reminder'`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/completion-from-reminder.js
'use strict';
// FATIA 1 do "não consegui registrar" (raiz 1a): a confirmação seca do usuário se refere ao
// que o TOM ACABOU DE LEMBRAR. O lembrete vem do disparo (dispatcher), mas já está gravado em
// conversation_history com ref_type='task'/ref_id (Lote D / sendAndLink). Aqui só se DECIDE o
// alvo — PURO, padrão do task-target.js. O engine busca as refs e executa.
//
// Freio do Alf: >1 tarefa DISTINTA lembrada = ambiguidade real, PERGUNTA — nunca escolhe pela
// mais recente. Só o mesmo task_id repetido colapsa (lembrete duplicado da mesma tarefa).

const JANELA_MS = 24 * 3600 * 1000;

// Conclusão inequívoca: whitelist conservadora. Na dúvida devolve false (deixa o fluxo atual
// seguir; nunca inventa conclusão). Veto de negação e de pergunta.
const CONCLUSAO_RE = /\b(feito|feita|pronto|prontinh[oa]|conclu[ií]d[oa]|conclu[ií]|okay|ok|isso|fechad[oa]|fechei|resolvid[oa]|resolvi|j[áa]\s+(?:fiz|foi|est[áa])|foi\s+feit[oa]|pode\s+(?:marcar|fechar|concluir))\b/i;
const NEGACAO_RE = /\b(n[ãa]o|ainda\s+n[ãa]o|nem)\b/i;

function ehConclusaoInequivoca(reply) {
  const t = String(reply || '').trim();
  if (!t || t.length > 120) return false;   // frase longa = não é confirmação seca
  if (t.endsWith('?')) return false;         // pergunta não confirma
  if (NEGACAO_RE.test(t)) return false;      // "não fiz" / "ainda não"
  return CONCLUSAO_RE.test(t);
}

function resolverConclusaoDeLembrete({ reply, refsRecentes, agoraMs } = {}) {
  if (!ehConclusaoInequivoca(reply)) return { modo: 'nenhum', motivo: 'nao_conclusao' };
  const agora = Number.isFinite(agoraMs) ? agoraMs : NaN;
  if (!Number.isFinite(agora)) return { modo: 'nenhum', motivo: 'sem_relogio' };

  const dentro = (Array.isArray(refsRecentes) ? refsRecentes : [])
    .filter((r) => r && r.task_id && r.reminded_at)
    .filter((r) => {
      const t = Date.parse(r.reminded_at);
      return Number.isFinite(t) && (agora - t) >= 0 && (agora - t) <= JANELA_MS;
    });
  if (dentro.length === 0) return { modo: 'nenhum', motivo: 'sem_ref_na_janela' };

  // Dedup por task_id: colapsa lembrete repetido da MESMA tarefa (a mais recente do mesmo id).
  // "A mais recente vence" vale SÓ dentro do mesmo id — NUNCA entre ids distintos (freio #2).
  const porId = new Map();
  for (const r of dentro) {
    const prev = porId.get(r.task_id);
    if (!prev || Date.parse(r.reminded_at) > Date.parse(prev.reminded_at)) porId.set(r.task_id, r);
  }
  const distintos = [...porId.values()];
  if (distintos.length === 1) {
    return { modo: 'exato', taskId: distintos[0].task_id, title: distintos[0].title || null, motivo: 'unico' };
  }
  // >1 tarefa distinta → ambiguidade real. Colapso de série adiado (freio #2): perguntar é seguro.
  return {
    modo: 'ambiguo',
    candidatos: distintos.map((r) => ({ taskId: r.task_id, title: r.title || null })),
    motivo: 'multiplas_distintas',
  };
}

module.exports = { resolverConclusaoDeLembrete, ehConclusaoInequivoca, JANELA_MS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /d/la-organizer/_remote && node --test src/lib/completion-from-reminder.test.js`
Expected: PASS — `# pass 9  # fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /d/la-organizer/_remote
git add src/lib/completion-from-reminder.js src/lib/completion-from-reminder.test.js
git commit -m "feat(completion): resolvedor puro confirmacao-seca -> tarefa recem-lembrada (Fatia 1)"
```

---

### Task 2: Busca de refs de lembrete no engine (`fetchRecentTaskReminderRefs`)

**Files:**
- Modify: `src/engine.js` (adicionar a função helper perto das outras helpers de leitura; não dentro de `processMessage`)
- Test: `src/lib/reminder-refs-query.test.js` (testa o SHAPE da query com um supabase fake — o helper delega a construção da query pra um builder puro exportável)

**Interfaces:**
- Consumes: `resolverConclusaoDeLembrete` (Task 1) — só no consumidor (Task 3), não aqui.
- Produces:
  - `buildReminderRefsQuery(supabase, collaboratorId, desdeIso)` — PURO/testável: monta e devolve o builder do supabase (registra `.eq('ref_type','task')`, `direction='outbound'`, `gte('created_at', desdeIso)`). Exportado de um módulo novo `src/lib/reminder-refs-query.js`.
  - `mapRefRows(rows) → Array<{task_id, title, reminded_at}>` — PURO: mapeia linhas de `conversation_history` (`ref_id`→`task_id`, `created_at`→`reminded_at`, title=null aqui; enriquecido na Task 3).

> Por que um módulo separado e não inline no engine: o engine não é testável isolado (importa supabase/client). O `task-target.js` e o `confere-fontes.js` seguem esse padrão — a lógica testável mora num `lib/` puro, o engine só chama.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/reminder-refs-query.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildReminderRefsQuery, mapRefRows } = require('./reminder-refs-query');

function fakeSb(sink) {
  const b = {
    from(t) { sink.from = t; return b; },
    select(c) { sink.select = c; return b; },
    eq(col, val) { (sink.eq ||= []).push([col, val]); return b; },
    gte(col, val) { sink.gte = [col, val]; return b; },
    order() { return b; },
    limit() { return b; },
  };
  return b;
}

test('a query filtra ref_type=task, outbound, e a janela', () => {
  const sink = {};
  buildReminderRefsQuery(fakeSb(sink), 'collab-1', '2026-08-15T18:00:00Z');
  assert.strictEqual(sink.from, 'conversation_history');
  assert.deepStrictEqual(sink.eq.find(([c]) => c === 'ref_type'), ['ref_type', 'task']);
  assert.deepStrictEqual(sink.eq.find(([c]) => c === 'direction'), ['direction', 'outbound']);
  assert.deepStrictEqual(sink.eq.find(([c]) => c === 'collaborator_id'), ['collaborator_id', 'collab-1']);
  assert.deepStrictEqual(sink.gte, ['created_at', '2026-08-15T18:00:00Z']);
});

test('mapRefRows converte ref_id/created_at e ignora linha sem ref_id', () => {
  const out = mapRefRows([
    { ref_id: 't1', created_at: '2026-08-16T15:00:00Z', content: '⏰ *Remédios* ...' },
    { ref_id: null, created_at: '2026-08-16T16:00:00Z', content: 'nota qualquer' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0], { task_id: 't1', title: null, reminded_at: '2026-08-16T15:00:00Z' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /d/la-organizer/_remote && node --test src/lib/reminder-refs-query.test.js`
Expected: FAIL — `Cannot find module './reminder-refs-query'`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/reminder-refs-query.js
'use strict';
// Busca as referências de TAREFA que o TOM surfou pra essa pessoa nas últimas 24h — as linhas
// que o sendAndLink (Lote D) gravou em conversation_history com ref_type='task'. Builder puro
// pra travar o SHAPE em teste (o engine não é testável isolado). Title vem null aqui: o
// consumidor (engine) enriquece com o título/status da tarefa por id, que é onde também mora a
// checagem de idempotência do freio #4.

function buildReminderRefsQuery(supabase, collaboratorId, desdeIso) {
  return supabase
    .from('conversation_history')
    .select('ref_id, content, created_at')
    .eq('collaborator_id', collaboratorId)
    .eq('direction', 'outbound')
    .eq('ref_type', 'task')
    .gte('created_at', desdeIso)
    .order('created_at', { ascending: false })
    .limit(20);
}

function mapRefRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.ref_id)
    .map((r) => ({ task_id: r.ref_id, title: null, reminded_at: r.created_at }));
}

module.exports = { buildReminderRefsQuery, mapRefRows };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /d/la-organizer/_remote && node --test src/lib/reminder-refs-query.test.js`
Expected: PASS — `# pass 2  # fail 0`.

- [ ] **Step 5: Verify the `ref_type`/`ref_id` columns exist**

Run (MCP Supabase `execute_sql`, projeto `cesnbnrynvxvgdhfmaua`):
```sql
select column_name from information_schema.columns
where table_name='conversation_history' and column_name in ('ref_type','ref_id');
```
Expected: as duas colunas existem (gravadas pelo `proactive-link.buildProactiveLogRow`). Se faltarem, PARE — a premissa do Lote D não vale nesta base; leve ao Alf.

- [ ] **Step 6: Commit**

```bash
cd /d/la-organizer/_remote
git add src/lib/reminder-refs-query.js src/lib/reminder-refs-query.test.js
git commit -m "feat(completion): busca das refs de lembrete de tarefa (24h) para a Fatia 1"
```

---

### Task 3: Wiring no engine — executar por id + dica de voz + supressão condicional do guard

**Files:**
- Modify: `src/engine.js`
  - Import perto do topo (junto de `resolveTaskTarget`, ~linha 50).
  - Interceptor NOVO logo antes de `buildSystemPrompt` (~linha 10770), dentro de `processMessage`. NÃO dá `return` — executa e segue pro LLM.
  - Injeção da dica no bloco de `systemPrompt += ...` (~10780).
  - Um `&&` a mais no `nothingPersisted` do `enforceNoMarkerHonesty` (~13434).

**Interfaces:**
- Consumes: `resolverConclusaoDeLembrete` (Task 1), `buildReminderRefsQuery` + `mapRefRows` (Task 2), `applyTaskActions(collaborator, actions, opts)` (existente; retorna `{ okCount, failCount, ... }`), o padrão `action.id` de 8 chars sem hífen (engine.js:4506).
- Produces: comportamento novo do turno; nenhuma assinatura pública nova.

> **Contexto de execução (ler antes):** passar `action.id` PULA o title-lookup (engine.js:4473 `if (!a.id && a.title)`) → conclui por id exato, sem `all_failed` (freios #3). O guard usa `nothingPersisted = !marker_emitted && !auto_retry_succeeded` (engine.js:13434); nossa execução determinística NÃO seta `marker_emitted`, então sem o freio #4 o guard desmentiria a voz do LLM. Idempotência é checada por status ANTES de completar, pra não depender de comportamento não-testado do handler com tarefa já `done`.

- [ ] **Step 1: `.deploy-hold` nos dois caminhos (engine é compartilhado)**

```bash
cd /d/la-organizer && printf 'catraca: fatia1 confirmacao seca\n' > .deploy-hold && cp .deploy-hold _remote/.deploy-hold
```

- [ ] **Step 2: Import dos módulos (topo do engine, ~linha 50)**

Adicionar após `const { resolveTaskTarget, serieDe } = require('./lib/task-target');`:
```js
const { resolverConclusaoDeLembrete } = require('./lib/completion-from-reminder');
const { buildReminderRefsQuery, mapRefRows } = require('./lib/reminder-refs-query');
```

- [ ] **Step 3: Interceptor determinístico ANTES do `buildSystemPrompt`**

Localizar `let { systemPrompt, ctx } = await buildSystemPrompt(collab, _promptOpts);` (~10770). Inserir IMEDIATAMENTE ANTES:

```js
  // FATIA 1 (não-consegui-registrar 1a): confirmação seca amarra na tarefa que o TOM lembrou
  // nas últimas 24h (sendAndLink gravou ref_type='task'). Resolve/executa DETERMINÍSTICO por id
  // exato; o LLM só escreve a confirmação (voz sagrada). NÃO dá return — segue pro LLM.
  let _remCompleteHint = null;
  try {
    const _agora = Date.now();
    const _desdeIso = new Date(_agora - 24 * 3600 * 1000).toISOString();
    const { data: _remRows } = await buildReminderRefsQuery(supabase, collab.id, _desdeIso);
    const _cfr = resolverConclusaoDeLembrete({ reply: text, refsRecentes: mapRefRows(_remRows), agoraMs: _agora });

    if (_cfr.modo === 'exato') {
      const { data: _tk } = await supabase.from('tasks')
        .select('id, title, status').eq('id', _cfr.taskId).maybeSingle();
      if (_tk && (_tk.status === 'done')) {
        // Idempotência real: já estava concluída → sucesso (freio #4 permite suprimir).
        _metrics.deterministic_complete_ok = true;
        _remCompleteHint = `### ✅ AÇÃO JÁ REGISTRADA\nA tarefa *${_tk.title}* já estava concluída. O usuário confirmou de novo — responda breve e leve, na sua voz, SEM dizer que falhou e SEM reabrir.`;
      } else if (_tk) {
        const _idCurto = String(_tk.id).replace(/-/g, '').slice(0, 8);
        const _r = await applyTaskActions(collab, [{ action: 'complete', id: _idCurto }], { inboundText: text });
        if (_r && _r.okCount >= 1) {
          // Sucesso real → pode suprimir o guard (freio #4).
          _metrics.deterministic_complete_ok = true;
          _remCompleteHint = `### ✅ AÇÃO JÁ REGISTRADA\nVocê acabou de concluir *${_tk.title}* (o usuário confirmou o lembrete). JÁ está registrada. Confirme calorosamente na sua voz — NÃO diga que não conseguiu, NÃO peça pra mandar de novo.`;
        }
        // Falhou (okCount 0) → NÃO seta flag, NÃO injeta hint: o fluxo honesto atual vale (freio #4).
      }
    } else if (_cfr.modo === 'ambiguo') {
      const _ids = _cfr.candidatos.map((c) => c.taskId);
      const { data: _tks } = await supabase.from('tasks').select('id, title').in('id', _ids);
      const _lista = (_tks || []).map((t) => `- *${t.title}*`).join('\n');
      // NÃO completa nada (freio #2). Pede desambiguação; a pergunta sai na voz do LLM.
      _remCompleteHint = `### ❓ QUAL TAREFA?\nO usuário confirmou uma conclusão, mas ele foi lembrado de MAIS DE UMA tarefa nas últimas horas:\n${_lista}\nPergunte QUAL delas ele concluiu. NÃO conclua nenhuma até ele dizer.`;
    }
  } catch (e) {
    // Freio #5: qualquer erro aqui degrada pro fluxo atual, nunca quebra o turno.
    console.warn('[CompletionFromReminder] non-fatal:', e.message);
  }
```

- [ ] **Step 4: Injetar a dica no `systemPrompt`**

Localizar o bloco `if (relayHint) systemPrompt += '\n\n' + relayHint;` (~10780). Adicionar logo depois:
```js
    if (_remCompleteHint) systemPrompt += '\n\n' + _remCompleteHint;
```

- [ ] **Step 5: Supressão CONDICIONAL do guard (freio #4)**

Localizar (engine.js ~13434):
```js
      nothingPersisted: !_metrics.marker_emitted && !_metrics.auto_retry_succeeded,
```
Trocar por:
```js
      // deterministic_complete_ok: a Fatia 1 concluiu por id exato ANTES do LLM (ou idempotência
      // real). Só é setado no SUCESSO — falha não seta, e aí o caminho honesto continua valendo.
      nothingPersisted: !_metrics.marker_emitted && !_metrics.auto_retry_succeeded && !_metrics.deterministic_complete_ok,
```

- [ ] **Step 6: Garantir `_metrics.deterministic_complete_ok` inicializado**

Localizar a criação de `_metrics` no início de `processMessage` (grep `_metrics = {` em `src/engine.js`). Confirmar que campos ausentes lêem `undefined` (o `!undefined === true`, então o default preserva o comportamento atual). Nenhuma mudança necessária se `_metrics` é objeto literal aberto; se houver shape fechado/validado, adicionar `deterministic_complete_ok: false`.

- [ ] **Step 7: Syntax check + suíte completa (zero-regressão)**

Run:
```bash
cd /d/la-organizer/_remote && node --check src/engine.js && node --test "src/**/*.test.js" 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: `SYNTAX OK`; `fail 4` (sem env) = baseline — NENHUM teste novo quebrado além das 4 conhecidas (`system-loadout`, `skill-quote-contamination`, `group-chat-tasks`, `pending-intents-detect`).

- [ ] **Step 8: Commit**

```bash
cd /d/la-organizer/_remote
git add src/engine.js
git commit -m "feat(engine): Fatia 1 — confirmacao seca conclui tarefa recem-lembrada por id exato + guard condicional"
```

---

### Task 4: Cenário Replay Lab + validação em produção

**Files:**
- Create: `scripts/replay-lab-cenario-confirma-lembrete.js`

**Interfaces:**
- Consumes: infra do Replay Lab (perfis `[QA] Replay 01-04`, webhook HMAC porta 3199, `sendAndLink` real via fixture de lembrete).

- [ ] **Step 1: Escrever o cenário**

Fixture: cria 1 tarefa pro perfil QA, dispara um lembrete REAL por `proactive-link.sendAndLink` (grava a ref em `conversation_history`), então injeta "feito" solto e mede:
```js
#!/usr/bin/env node
// scripts/replay-lab-cenario-confirma-lembrete.js
// FATIA 1: lembrete de tarefa (sendAndLink grava ref_type='task') → "feito" solto →
// a tarefa fica DONE, sem all_failed, sem "não consegui registrar", e a confirmação sai na voz.
'use strict';
const crypto = require('crypto');
const supabase = require('../src/supabase/client');
const proactiveLink = require('../src/services/proactive-link');

const PORTA = Number(process.env.PORT_LAB || 3199);
const SEGREDO = process.env.WEBHOOK_SECRET;
const QA_PHONE = (process.env.TOM_QA_PHONES || '').split(',')[0].trim();
const QA_NOME = '[QA] Replay 01';
if (!SEGREDO || !QA_PHONE) { console.error('faltou WEBHOOK_SECRET/TOM_QA_PHONES'); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function perfil() {
  const { data } = await supabase.from('collaborators').select('id').eq('full_name', QA_NOME).maybeSingle();
  if (!data) throw new Error(`perfil ${QA_NOME} não existe`);
  return data.id;
}
async function limpar(cid) {
  await supabase.from('tasks').delete().eq('assigned_to', cid).ilike('title', 'QA Bombinha%');
  await supabase.from('conversation_history').delete().eq('collaborator_id', cid);
}
async function falar(phone, texto) {
  const corpo = JSON.stringify({ EventType: 'messages', message: { id: `qa-cfr-${Date.now()}`, sender: `${phone}@s.whatsapp.net`, chatid: `${phone}@s.whatsapp.net`, text: texto, fromMe: false } });
  const sig = 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
  await fetch(`http://127.0.0.1:${PORTA}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig }, body: corpo });
}
async function ultimaResposta(cid, desdeIso) {
  const { data } = await supabase.from('conversation_history').select('content').eq('collaborator_id', cid)
    .eq('direction', 'outbound').gt('created_at', desdeIso).order('created_at', { ascending: true }).limit(5);
  return (data || []).map((m) => m.content || '').join('\n---\n');
}

(async () => {
  const cid = await perfil();
  await limpar(cid);
  const { data: tk } = await supabase.from('tasks').insert({
    assigned_to: cid, created_by: cid, title: 'QA Bombinha do dia', status: 'pending',
    due_date: new Date().toISOString().slice(0, 10),
  }).select('id, title').single();
  // Lembrete REAL — grava ref_type='task' em conversation_history, igual produção.
  await proactiveLink.sendAndLink(supabase, { phone: QA_PHONE, content: `⏰ lembrete: *${tk.title}* — tudo certo?`, collaboratorId: cid, refType: 'task', refId: tk.id });
  await dorme(1500);

  const t0 = new Date().toISOString();
  await falar(QA_PHONE, 'feito');
  await dorme(45000);
  const resp = await ultimaResposta(cid, t0);
  console.log(`\n[resposta] ${resp.replace(/\s+/g, ' ').slice(0, 200)}`);

  if (!resp.trim()) { console.error('SEM RESPOSTA — instrumento não mediu (timeout?). exit 2'); await limpar(cid); process.exit(2); }
  const { data: tk2 } = await supabase.from('tasks').select('status').eq('id', tk.id).maybeSingle();

  const ficouDone = tk2 && tk2.status === 'done';
  const disseNaoConsegui = /n[ãa]o consegui registrar/i.test(resp);
  console.log(`(a) tarefa DONE: ${ficouDone ? 'OK' : 'FALHOU'}`);
  console.log(`(b) NÃO disse "não consegui registrar": ${!disseNaoConsegui ? 'OK' : 'FALHOU'}`);
  const ok = ficouDone && !disseNaoConsegui;
  await limpar(cid);
  console.log(`\n[cenario-confirma-lembrete] ${ok ? 'PASSOU' : 'FALHOU'}`);
  process.exit(ok ? 0 : 1);
})();
```

- [ ] **Step 2: Deploy cirúrgico + rodar o cenário na VPS**

```bash
# libera o hold, sobe, confere md5, restart provado
cd /d/la-organizer/_remote && git push origin main
ssh tom "cd /opt/LA-Organizer && git fetch -q origin && git reset --hard -q origin/main && md5sum src/engine.js src/lib/completion-from-reminder.js"
# comparar com: md5sum local dos mesmos arquivos (devem bater)
rm -f /d/la-organizer/.deploy-hold /d/la-organizer/_remote/.deploy-hold
ssh tom "cd /opt/LA-Organizer && pm2 restart tom >/dev/null 2>&1 && sleep 4 && ps -o lstart= -p \$(pm2 jlist | node -e 'let d=\"\";process.stdin.on(c=>d+=c).on(\"end\",()=>{const p=JSON.parse(d).find(x=>x.name===\"tom\");console.log(p.pid)})')"
bash scripts/replay-lab-run.sh cenario-confirma-lembrete   # PASSOU esperado
```
Expected: `PASSOU` — a tarefa QA fica `done`, resposta na voz, sem "não consegui registrar".

- [ ] **Step 3: Suíte na VPS com env (baseline real)**

Run: `ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/ 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `fail 3` = baseline (+ os testes novos das Tasks 1-2 passando).

- [ ] **Step 4: Registrar no `tom_known_issues`**

`INSERT` (MCP, projeto `cesnbnrynvxvgdhfmaua`) do KI `NAOREGISTREI-1A-CONFIRMA-LEMBRETE` com `sinal_tipo='manual'`, causa-raiz (confirmação seca não resolvia o alvo → all_failed) e fix (resolução determinística por ref_id de lembrete em 24h; Fatia 1). Deixa rastro pro placar e pra auditoria medir a queda do patamar.

- [ ] **Step 5: Commit do cenário**

```bash
cd /d/la-organizer/_remote
git add scripts/replay-lab-cenario-confirma-lembrete.js
git commit -m "test(replay): cenario Fatia 1 — confirmacao seca conclui tarefa recem-lembrada"
```

---

## Self-Review (feita)

**1. Cobertura da spec:**
- Sinal `conversation_history` ref_type='task' 24h → Task 2. ✓
- Resolvedor puro (exato/ambiguo/nenhum) → Task 1. ✓
- Interceptor pré-LLM + execução por id exato → Task 3 Steps 3. ✓
- Voz do LLM (dica no systemPrompt) → Task 3 Step 4. ✓
- Freio #2 (ambíguo pergunta, nunca recência) → Task 1 teste obrigatório + Task 3 ramo `ambiguo`. ✓
- Freio #4 (suprime guard só no sucesso/idempotência) → Task 3 Steps 5-6 + a lógica condicional do Step 3. ✓ (teste do freio #4 é de integração — coberto pelo Replay Step 2 + a asserção de que okCount<1 não seta o flag; um teste unitário puro não alcança porque a supressão é no engine. Ver nota abaixo.)
- Freio #5 (degrada em erro) → Task 3 Step 3 `catch`. ✓
- Freio #6 (replay) → Task 4. ✓

**2. Placeholders:** nenhum "TBD/etc" — todo passo tem código ou comando real.

**3. Consistência de tipos:** `resolverConclusaoDeLembrete` retorna `{modo, taskId, title, candidatos, motivo}` — usado igual na Task 3. `action.id` de 8 chars sem hífen bate com engine.js:4506. `_metrics.deterministic_complete_ok` idêntico no set (Step 3) e no uso (Step 5).

**Nota — freio #4 (teste obrigatório):** a supressão é no engine (não puro), então o teste "obrigatório" do freio #4 é o **Replay** (Task 4 Step 2, PASSOU) + uma variante manual: forçar o `complete` a falhar (ex.: id de tarefa já cancelada) e conferir que "não consegui registrar" ainda aparece (guard NÃO suprimido). Adicionar essa variante ao cenário do Replay se a primeira rodada passar limpa — é o par vermelho/verde do freio.
