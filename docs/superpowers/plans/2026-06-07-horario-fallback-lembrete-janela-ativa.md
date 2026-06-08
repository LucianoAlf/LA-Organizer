# Horário-fallback de lembrete por janela ativa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando alguém pede lembrete sem hora ("me lembra amanhã"), o TOM afirma um horário coerente com a rotina da pessoa (aprendido do uso) em vez de perguntar.

**Architecture:** Serviço puro novo `active-window.js` calcula o "início típico do dia" da pessoa a partir de `conversation_history` (inbound, 30d). O engine resolve esse horário 1x por mensagem e injeta uma linha no system prompt; a skill `criar-compromisso.md` manda o LLM afirmar esse horário e criar a task com `remind_at` preenchido. Cold-start = 09h. Tudo aditivo.

**Tech Stack:** Node.js CommonJS, Supabase JS client, Intl.DateTimeFormat (timezone BRT), node:assert para testes.

---

## File Structure

- **Create** `src/services/active-window.js` — `computeStartHour` (pura) + `getActiveWindow` (supabase injetado) + `brtHourAndDay` (helper).
- **Create** `src/services/active-window.test.js` — unit puro de `computeStartHour`.
- **Create** `scripts/smoke-active-window.js` — smoke de `getActiveWindow` com supabase fake.
- **Modify** `src/prompts/system.js` — injeta a linha "Horário-padrão de lembrete…" no contexto.
- **Modify** `src/engine.js` — chama `getActiveWindow` 1x por mensagem e passa pro `buildContext`.
- **Modify** `skills/criar-compromisso.md` — regra "lembrete sem hora → afirma, não pergunta".

---

## Task 1: `computeStartHour` (função pura) + testes

**Files:**
- Create: `src/services/active-window.js`
- Test: `src/services/active-window.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/services/active-window.test.js
'use strict';
const assert = require('assert');
const { computeStartHour } = require('./active-window');

// Anne-like: ativa de manhã-tarde-noite (18 amostras)
const anne = [10,10,11,11,11,12,13,14,15,16,18,19,20,21,22,11,12,13];
// Alf-like: cedo (18 amostras)
const alf = [6,7,7,7,8,8,8,9,9,10,11,12,14,16,18,7,8,8];
// Poucos dados (< MIN_SAMPLES)
const few = [9,10,11];

const rAnne = computeStartHour(anne);
assert.deepStrictEqual(rAnne, { hour: 11, minute: 0 }, `Anne: esperava 11h, veio ${JSON.stringify(rAnne)}`);

const rAlf = computeStartHour(alf);
assert.deepStrictEqual(rAlf, { hour: 7, minute: 0 }, `Alf: esperava 7h, veio ${JSON.stringify(rAlf)}`);

assert.strictEqual(computeStartHour(few), null, 'poucos dados → null');
assert.strictEqual(computeStartHour([]), null, 'vazio → null');
assert.strictEqual(computeStartHour(null), null, 'null → null');

// Horas inválidas são filtradas (não contam pra amostra nem distorcem)
const dirty = anne.concat([25, -1, NaN, 99]);
assert.deepStrictEqual(computeStartHour(dirty), { hour: 11, minute: 0 }, 'lixo filtrado');

console.log('OK active-window.test (computeStartHour) — 6/6');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/la-organizer/_remote && node src/services/active-window.test.js`
Expected: FAIL — `Cannot find module './active-window'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/services/active-window.js
'use strict';

const COLD_START_HOUR = 9;       // default global quando não há dado suficiente
const MIN_SAMPLES = 15;          // mínimo de mensagens inbound
const MIN_DISTINCT_DAYS = 5;     // em pelo menos N dias distintos
const LOOKBACK_DAYS = 30;        // janela de histórico
const START_PERCENTILE = 0.20;   // percentil ~20 = "início típico do dia"

/**
 * Função PURA. Recebe horas BRT (0-23) das mensagens inbound e devolve o
 * "início típico do dia" = percentil START_PERCENTILE das horas, arredondado
 * pra hora cheia. Retorna null se a amostra (após limpeza) for insuficiente.
 *
 * @param {number[]} hoursBrt
 * @param {{minSamples?:number}} [opts]
 * @returns {{hour:number, minute:number}|null}
 */
function computeStartHour(hoursBrt, opts = {}) {
  const minSamples = (opts && opts.minSamples != null) ? opts.minSamples : MIN_SAMPLES;
  const hours = (Array.isArray(hoursBrt) ? hoursBrt : [])
    .filter(h => Number.isInteger(h) && h >= 0 && h <= 23);
  if (hours.length < minSamples) return null;
  const sorted = hours.slice().sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * START_PERCENTILE), sorted.length - 1);
  return { hour: sorted[idx], minute: 0 };
}

module.exports = {
  computeStartHour,
  COLD_START_HOUR,
  MIN_SAMPLES,
  MIN_DISTINCT_DAYS,
  LOOKBACK_DAYS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /d/la-organizer/_remote && node src/services/active-window.test.js`
Expected: PASS — `OK active-window.test (computeStartHour) — 6/6`

- [ ] **Step 5: Commit**

```bash
git add src/services/active-window.js src/services/active-window.test.js
git commit -m "feat(active-window): computeStartHour puro + testes"
```

---

## Task 2: `brtHourAndDay` + `getActiveWindow` (supabase injetado) + smoke

**Files:**
- Modify: `src/services/active-window.js`
- Create: `scripts/smoke-active-window.js`

- [ ] **Step 1: Write the failing smoke test**

```js
// scripts/smoke-active-window.js
'use strict';
const assert = require('assert');
const { getActiveWindow } = require('../src/services/active-window');

// Supabase fake: builder encadeável; .gte (último elo) resolve a promise.
function fakeSupabase(rows) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    gte() { return Promise.resolve({ data: rows, error: null }); },
  };
  return { from() { return builder; } };
}
// Erro de DB
function fakeSupabaseErr() {
  const builder = {
    select() { return this; },
    eq() { return this; },
    gte() { return Promise.resolve({ data: null, error: { message: 'boom' } }); },
  };
  return { from() { return builder; } };
}

const NOW = new Date('2026-06-07T12:00:00Z');

(async () => {
  // 1) Dado suficiente (Alf-like cedo): 18 msgs em 6 dias distintos → learned ~7h
  const rows = [];
  const baseDays = ['01','02','03','04','05','06'];
  const horasUtc = [10,11,11,12]; // 10h UTC = 07h BRT (-03)
  for (const d of baseDays) {
    for (const h of horasUtc) {
      rows.push({ created_at: `2026-06-${d}T${String(h).padStart(2,'0')}:30:00Z` });
    }
  }
  const learned = await getActiveWindow(fakeSupabase(rows), 'collab-1', NOW);
  assert.strictEqual(learned.source, 'learned', `esperava learned, veio ${learned.source}`);
  assert.strictEqual(learned.confident, true);
  assert.strictEqual(learned.hour, 7, `esperava 7h BRT, veio ${learned.hour}`);

  // 2) Poucos dias distintos → cold-start 09h
  const poucos = [
    { created_at: '2026-06-06T11:00:00Z' },
    { created_at: '2026-06-06T12:00:00Z' },
    { created_at: '2026-06-06T13:00:00Z' },
  ];
  const cold = await getActiveWindow(fakeSupabase(poucos), 'collab-2', NOW);
  assert.strictEqual(cold.source, 'cold_start', `esperava cold_start, veio ${cold.source}`);
  assert.strictEqual(cold.hour, 9);
  assert.strictEqual(cold.confident, false);

  // 3) Sem dado → cold-start
  const vazio = await getActiveWindow(fakeSupabase([]), 'collab-3', NOW);
  assert.strictEqual(vazio.source, 'cold_start');
  assert.strictEqual(vazio.hour, 9);

  // 4) Erro de DB → cold-start (degrada gracioso, nunca derruba)
  const errCase = await getActiveWindow(fakeSupabaseErr(), 'collab-4', NOW);
  assert.strictEqual(errCase.source, 'cold_start');
  assert.strictEqual(errCase.hour, 9);

  // 5) supabase/collabId ausentes → cold-start
  const nil = await getActiveWindow(null, null, NOW);
  assert.strictEqual(nil.source, 'cold_start');

  console.log('OK smoke-active-window — 5/5');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `cd /d/la-organizer/_remote && node scripts/smoke-active-window.js`
Expected: FAIL — `getActiveWindow is not a function`.

- [ ] **Step 3: Implement `brtHourAndDay` + `getActiveWindow`**

Adicionar em `src/services/active-window.js`, ANTES do `module.exports`:

```js
/**
 * Converte ISO UTC → hora BRT (0-23) e dia YYYY-MM-DD (BRT). Usa Intl com
 * timeZone America/Sao_Paulo (cobre o offset -03:00 sem hardcode).
 * @param {string} iso
 * @returns {{hour:number|null, ymd:string|null}}
 */
function brtHourAndDay(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return { hour: null, ymd: null };
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  let yy = null, mm = null, dd = null, hh = null;
  for (const p of parts) {
    if (p.type === 'year') yy = p.value;
    else if (p.type === 'month') mm = p.value;
    else if (p.type === 'day') dd = p.value;
    else if (p.type === 'hour') hh = parseInt(p.value, 10);
  }
  if (hh === 24) hh = 0; // en-CA hour12:false pode emitir '24' à meia-noite
  if (yy == null || hh == null || Number.isNaN(hh)) return { hour: null, ymd: null };
  return { hour: hh, ymd: `${yy}-${mm}-${dd}` };
}

/**
 * Resolve o horário-padrão de lembrete da pessoa a partir do histórico inbound.
 * Degrada pra cold-start (09h) em QUALQUER falta de dado/erro — nunca lança.
 *
 * @param {object} supabase  cliente Supabase (injetado)
 * @param {string} collabId
 * @param {Date}   now
 * @returns {Promise<{hour:number,minute:number,confident:boolean,source:'learned'|'cold_start'}>}
 */
async function getActiveWindow(supabase, collabId, now) {
  const fallback = { hour: COLD_START_HOUR, minute: 0, confident: false, source: 'cold_start' };
  if (!supabase || !collabId) return fallback;
  const ref = (now instanceof Date && !Number.isNaN(now.getTime())) ? now : new Date();
  try {
    const sinceIso = new Date(ref.getTime() - LOOKBACK_DAYS * 86400000).toISOString();
    const { data, error } = await supabase
      .from('conversation_history')
      .select('created_at')
      .eq('collaborator_id', collabId)
      .eq('direction', 'inbound')
      .gte('created_at', sinceIso);
    if (error || !Array.isArray(data) || !data.length) return fallback;

    const hours = [];
    const days = new Set();
    for (const row of data) {
      const { hour, ymd } = brtHourAndDay(row && row.created_at);
      if (hour == null) continue;
      hours.push(hour);
      days.add(ymd);
    }
    if (hours.length < MIN_SAMPLES || days.size < MIN_DISTINCT_DAYS) return fallback;

    const res = computeStartHour(hours);
    if (!res) return fallback;
    return { hour: res.hour, minute: res.minute, confident: true, source: 'learned' };
  } catch (_e) {
    return fallback;
  }
}
```

Atualizar o `module.exports`:

```js
module.exports = {
  computeStartHour,
  brtHourAndDay,
  getActiveWindow,
  COLD_START_HOUR,
  MIN_SAMPLES,
  MIN_DISTINCT_DAYS,
  LOOKBACK_DAYS,
};
```

- [ ] **Step 4: Run smoke to verify it passes**

Run: `cd /d/la-organizer/_remote && node scripts/smoke-active-window.js`
Expected: PASS — `OK smoke-active-window — 5/5`

- [ ] **Step 5: Re-run unit + node --check**

Run: `cd /d/la-organizer/_remote && node src/services/active-window.test.js && node --check src/services/active-window.js`
Expected: PASS unit + sem erro de sintaxe.

- [ ] **Step 6: Commit**

```bash
git add src/services/active-window.js scripts/smoke-active-window.js
git commit -m "feat(active-window): getActiveWindow + brtHourAndDay + smoke"
```

---

## Task 3: Engine resolve o horário 1x por mensagem e passa pro buildContext

**Files:**
- Modify: `src/engine.js` (require no topo + chamada antes de `buildSystemPrompt`/`buildContext`)
- Modify: `src/prompts/system.js` (aceita `reminderDefaultHour` em `opts`/`ctx`)

> **Nota de descoberta:** localizar o ponto onde o engine monta o system prompt (ex.: `buildSystemPrompt(...)` por volta de `src/engine.js:7429`, onde já existe `_promptOpts`). O nome exato da função de contexto e a forma de passar opts devem ser confirmados lendo o trecho ANTES de editar. O passo abaixo descreve o padrão; ajuste o nome do campo ao que `system.js` já consome.

- [ ] **Step 1: Require no topo do engine**

Adicionar junto aos outros require de services (perto de `src/engine.js:20`):

```js
const { getActiveWindow } = require('./services/active-window');
```

- [ ] **Step 2: Resolver o horário antes de montar o prompt**

No ponto onde `_promptOpts` é montado (call-site do system prompt, ~`src/engine.js:7429`), adicionar ANTES da montagem:

```js
// Horário-padrão de lembrete (janela ativa aprendida do uso; cold-start 09h).
// Degrada gracioso — getActiveWindow nunca lança.
const _activeWin = await getActiveWindow(supabase, collaborator.id, new Date());
```

E incluir no objeto de opts passado ao builder:

```js
_promptOpts.reminderDefaultHour = _activeWin.hour; // 0-23
```

- [ ] **Step 3: `system.js` injeta a linha no contexto**

Em `src/prompts/system.js`, no builder de contexto que recebe `opts`, adicionar um bloco curto (usar o primeiro nome da pessoa já disponível no escopo — confirmar a variável, ex.: `nome`/`firstName`):

```js
// Horário-padrão de lembrete: quando o usuário dá o DIA mas não a HORA.
const _rh = Number.isInteger(opts && opts.reminderDefaultHour) ? opts.reminderDefaultHour : 9;
const _rhLabel = `${String(_rh).padStart(2, '0')}h`;
linhas.push(`Horário-padrão de lembrete pra esta pessoa quando ela não disser a hora: ${_rhLabel}.`);
```

(`linhas.push` é ilustrativo — usar o mecanismo de concatenação de contexto que o `system.js` já adota nesse builder.)

- [ ] **Step 4: Verificar sintaxe + smoke do prompt**

Run: `cd /d/la-organizer/_remote && node --check src/engine.js && node --check src/prompts/system.js`
Expected: PASS sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/engine.js src/prompts/system.js
git commit -m "feat(reminder-fallback): engine resolve horario-padrao e injeta no contexto"
```

---

## Task 4: Skill `criar-compromisso.md` — regra "lembrete sem hora → afirma"

**Files:**
- Modify: `skills/criar-compromisso.md` (logo após a seção "Tarefa SEM data → NUNCA assuma hoje", ~linha 64)

- [ ] **Step 1: Inserir a nova seção**

Adicionar após a seção da linha 58-64 ("Tarefa SEM data"):

```markdown
### ⏰ Lembrete com DIA mas SEM hora → afirma o horário, NÃO pergunte

Quando a pessoa pede um **lembrete/tarefa** dando o dia mas **sem a hora**
("me lembra amanhã", "me lembra sexta", "amanhã me cobra disso"):

- **NÃO pergunte que horas.** Perguntar trava (a pessoa some sem responder).
- Use o **horário-padrão** que vem no contexto ("Horário-padrão de lembrete
  pra esta pessoa…: HHh") e **afirme**:
  > "Fechou, te lembro amanhã às 9h. Quer outra hora?"
- Crie a task com `remind_at` = dia indicado + esse horário (ISO 8601 -03:00).
- Se a pessoa corrigir depois ("não, às 8h" / "mais cedo"), o **follow-up de
  horário** (seção abaixo) reagenda — não precisa caminho novo.

**Exemplo** (horário-padrão do contexto = 09h; user: "me lembra amanhã de ligar pro fornecedor"):
```text
Fechou! Te lembro amanhã às 9h de ligar pro fornecedor. Quer outra hora?
```
```text
<<TASK>>
[{"action":"create","title":"Ligar pro fornecedor","due_date":"2026-06-08","remind_at":"2026-06-08T09:00:00-03:00"}]
<<END>>
```

**⚠️ Escopo:** isso vale só pra **lembrete/tarefa**. **Compromisso com terceiros**
(reunião, aula, mentoria, ensaio, sessão, gravação) sem hora **continua pedindo a
hora** — não se chuta um horário pra reunião com outra pessoa.
```

> **Nota:** confirmar que o nome da action/campos (`<<TASK>>`, `action:"create"`,
> `remind_at`) batem com os exemplos já existentes na skill. Ajustar ao padrão real
> da skill se divergir (o engine aceita `remind_at` no create — verificado em
> engine.js: parser de TASK trata `remind_at`/`due_date` opcionais).

- [ ] **Step 2: Commit**

```bash
git add skills/criar-compromisso.md
git commit -m "feat(skill): lembrete sem hora afirma horario-padrao (nao pergunta)"
```

---

## Task 5: Deploy + e2e + ledger

**Files:**
- Deploy: `src/services/active-window.js`, `src/engine.js`, `src/prompts/system.js`, `skills/criar-compromisso.md`

- [ ] **Step 1: node --check em tudo que mudou**

Run: `cd /d/la-organizer/_remote && node --check src/services/active-window.js && node --check src/engine.js && node --check src/prompts/system.js`
Expected: PASS.

- [ ] **Step 2: Rodar testes locais**

Run: `cd /d/la-organizer/_remote && node src/services/active-window.test.js && node scripts/smoke-active-window.js`
Expected: `6/6` + `5/5`.

- [ ] **Step 3: SCP path absoluto pros 4 arquivos**

```bash
scp D:/la-organizer/_remote/src/services/active-window.js tom:/opt/LA-Organizer/src/services/active-window.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp D:/la-organizer/_remote/skills/criar-compromisso.md tom:/opt/LA-Organizer/skills/criar-compromisso.md
```

- [ ] **Step 4: md5 VPS == local (os 4)**

Run (comparar saída par a par):
```bash
md5sum D:/la-organizer/_remote/src/services/active-window.js D:/la-organizer/_remote/src/engine.js D:/la-organizer/_remote/src/prompts/system.js D:/la-organizer/_remote/skills/criar-compromisso.md
ssh tom "md5sum /opt/LA-Organizer/src/services/active-window.js /opt/LA-Organizer/src/engine.js /opt/LA-Organizer/src/prompts/system.js /opt/LA-Organizer/skills/criar-compromisso.md"
```
Expected: hashes idênticos.

- [ ] **Step 5: Restart + verificar online**

Run: `ssh tom "pm2 restart tom && sleep 3 && pm2 jlist | node -e 'let s=JSON.parse(require(\"fs\").readFileSync(0));let t=s.find(p=>p.name==\"tom\");console.log(t.pm2_env.status, \"restarts:\", t.pm2_env.restart_time)'"`
Expected: `online` e restart estável (sem loop de crash).

- [ ] **Step 6: e2e na VPS (require real do serviço)**

Run: `ssh tom "cd /opt/LA-Organizer && node -e 'const {getActiveWindow}=require(\"./src/services/active-window\"); const sb=require(\"./src/supabase/client\"); getActiveWindow(sb, process.env.SMOKE_COLLAB_ID || \"<um collab_id real>\", new Date()).then(r=>console.log(\"active-window:\", JSON.stringify(r)))'"`
Expected: imprime `{hour, source}` — `learned` pra quem tem histórico, `cold_start` pra quem não tem. (Substituir `<um collab_id real>` por um id válido, ex.: Anne.)

- [ ] **Step 7: Ledger em `tom_known_issues`**

Inserir registro (via Supabase MCP `execute_sql`, project `cesnbnrynvxvgdhfmaua`). Usar aspas DUPLAS em tokens internos; status `corrigido`:

```sql
INSERT INTO tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES (
  'LEMBRETE-HORA-FALLBACK',
  'Lembrete sem hora travava: TOM perguntava o horario e a pessoa nao respondia',
  'marker', 'medio', 'corrigido',
  'Nao havia horario-padrao de lembrete. A skill mandava perguntar a hora ou criar sem prazo; perguntar travava a conversa.',
  'Novo active-window.js infere o inicio tipico do dia (conversation_history inbound, 30d, percentil 20); cold-start 09h. system.js injeta a linha no contexto; skill criar-compromisso afirma o horario em vez de perguntar. Escopo so lembrete/task; compromisso com terceiros continua perguntando.',
  'manual',
  'usuario pede me lembra amanha sem hora e o TOM responde perguntando que horas',
  ARRAY['Anne'], now(), now(), 1, now()
);
```

- [ ] **Step 8: Commit final (docs/plan)**

```bash
git add docs/superpowers/specs docs/superpowers/plans
git commit -m "docs(reminder-fallback): spec + plan horario-fallback lembrete"
```

---

## Self-Review (preenchido)

- **Cobertura do spec:** §1 sinal → Task 1+2; §2 contexto → Task 3; §3 comportamento → Task 4; §cold-start/guardrail → Task 2 (cold-start) + nota (quiet-hours já no fire-time); §teste/deploy → Task 1,2,5. ✅
- **Placeholders:** dois pontos marcados como **Nota de descoberta** (nome exato da função de contexto em `system.js` e call-site `_promptOpts` no engine) — exigem leitura do arquivo antes de editar, não são código faltando. O resto é completo.
- **Consistência de tipos:** `getActiveWindow` retorna `{hour,minute,confident,source}`; engine usa `.hour`; `system.js` lê `opts.reminderDefaultHour` (Integer 0-23). `computeStartHour` retorna `{hour,minute}|null`. Coerente entre tasks.
- **Escopo:** uma fatia, sem decomposição. ✅
