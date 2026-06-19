# Paralelismo CLI do TOM — Fase 1 (código atrás da flag OFF) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir até K=2 execuções `claude -p` simultâneas (cada uma em HOME isolado), eliminando a serialização da `_claudeQueue` no pico — **tudo atrás da flag `TOM_CLAUDE_PARALLEL` (default OFF)**, de modo que o deploy não muda nada em produção até alguém ligar a flag (Fase 2, separada).

**Architecture:** 1 CANON (`.claude-tom`, único que refresca o token) + K workers persistentes (`.claude-tom-w0..w{K-1}`, cada um com cópia do `.credentials.json` e `.claude.json` próprio). A lógica pura (semáforo, decisão de refresh, paths, comparação de mtime) vai num módulo testável `src/ai/claude-pool.js`; o I/O (fs, spawn) fica em `src/ai/claude.js`. Com a flag OFF, `chat()`/`chatRaw()` caem no caminho serial atual (`_claudeQueue`), **byte-idêntico ao de hoje**.

**Tech Stack:** Node.js (CommonJS), `node:test`/`node:assert`, CLI `claude` headless, PM2 na VPS. Spec de referência: `docs/superpowers/specs/2026-06-19-paralelismo-claude-cli-home-isolado-design.md` (Fase 0 executada, Gate A satisfeito 19/06).

## Global Constraints

- **Flag `TOM_CLAUDE_PARALLEL` default OFF.** Com a flag ≠ '1', o comportamento é o serial atual, intacto. Nenhuma tarefa deste plano muda o caminho serial.
- **Workers NUNCA refrescam o token.** Só rodam com token em folga (> slack). Quando o token está perto de expirar (< slack), a chamada serializa no CANON (`canonLock`) e deixa o CLI refrescar "por carona". Isso protege o `refreshToken` do CANON (R1).
- **NÃO tocar no comportamento/respostas do TOM** (infra pura). **NÃO mexer no fail-fast/build async** já entregues.
- Parâmetros (env): `TOM_CLAUDE_PARALLEL` (=1 liga), `TOM_CLAUDE_POOL_SIZE` (default 2), `TOM_CLAUDE_REFRESH_SLACK_MS` (default 1800000 = 30 min).
- CANON HOME = `/opt/LA-Organizer/.claude-tom`; credenciais em `<HOME>/.claude/.credentials.json`.
- Testes: `node --test src/ai/claude-pool.test.js`. Sintaxe: `node --check`.
- Deploy: scp + `pm2 restart tom`. **Deploy da Fase 1 é seguro** (flag OFF). **Ligar a flag = Fase 2**, exige o gate de re-login ensaiado com o Alf (ver fim do plano).

---

### Task 1: Módulo `claude-pool.js` — lógica pura testável

**Files:**
- Create: `src/ai/claude-pool.js`
- Create: `src/ai/claude-pool.test.js`

**Interfaces:**
- Produces:
  - `createSemaphore(homes: string[]) -> { acquire(): Promise<{home,index}>, release(slot), size, available() }`
  - `decideRefreshMode(expiresAt: number, now: number, slackMs: number) -> 'pool' | 'canon'`
  - `workerHomePath(canonHome: string, i: number) -> string`
  - `needsCredSync(srcMtimeMs: number, dstMtimeMs: number|null) -> boolean`

- [ ] **Step 1: Escrever os testes (falham primeiro)**

Create `src/ai/claude-pool.test.js`:
```js
// Rodar: node --test src/ai/claude-pool.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { createSemaphore, decideRefreshMode, workerHomePath, needsCredSync } = require('./claude-pool');

test('semaphore: dá lease até K, o (K+1)-ésimo espera até um release', async () => {
  const sem = createSemaphore(['/h/w0', '/h/w1']);
  const a = await sem.acquire();
  const b = await sem.acquire();
  assert.notStrictEqual(a.index, b.index, 'leases distintos');
  assert.strictEqual(sem.available(), 0);
  let cResolved = false;
  const cP = sem.acquire().then((s) => { cResolved = true; return s; });
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(cResolved, false, 'o 3º fica pendente com pool cheio');
  sem.release(a);
  const c = await cP;
  assert.strictEqual(c.home, a.home, 'o waiter recebe o slot liberado');
});

test('decideRefreshMode: pool quando há folga, canon quando perto de expirar', () => {
  const now = 1_000_000;
  const slack = 30 * 60 * 1000;
  assert.strictEqual(decideRefreshMode(now + 2 * 60 * 60 * 1000, now, slack), 'pool');
  assert.strictEqual(decideRefreshMode(now + 10 * 60 * 1000, now, slack), 'canon');
  assert.strictEqual(decideRefreshMode(0, now, slack), 'canon', 'sem expiresAt → canon (seguro)');
});

test('workerHomePath: deriva .claude-tom-w{i} ao lado do CANON', () => {
  assert.strictEqual(workerHomePath('/opt/LA-Organizer/.claude-tom', 0), '/opt/LA-Organizer/.claude-tom-w0');
  assert.strictEqual(workerHomePath('/opt/LA-Organizer/.claude-tom', 1), '/opt/LA-Organizer/.claude-tom-w1');
});

test('needsCredSync: copia se destino não existe ou está mais velho', () => {
  assert.strictEqual(needsCredSync(100, null), true, 'destino ausente → copia');
  assert.strictEqual(needsCredSync(100, 50), true, 'destino mais velho → copia');
  assert.strictEqual(needsCredSync(100, 100), false, 'igual → não copia');
  assert.strictEqual(needsCredSync(100, 200), false, 'destino mais novo → não copia');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/ai/claude-pool.test.js`
Expected: FAIL — `Cannot find module './claude-pool'`.

- [ ] **Step 3: Implementar o módulo**

Create `src/ai/claude-pool.js`:
```js
// Lógica pura do pool de workers do CLI claude. SEM I/O (fs/spawn) — testável.
// O I/O (criar HOMEs, copiar credenciais, spawn) fica em claude.js.

// Semáforo de K slots, 1 por worker HOME. acquire() resolve com {home,index};
// se todos ocupados, enfileira e resolve quando alguém der release().
function createSemaphore(homes) {
  const slots = homes.map((home, index) => ({ home, index, busy: false }));
  const waiters = [];
  function acquire() {
    const free = slots.find((s) => !s.busy);
    if (free) { free.busy = true; return Promise.resolve(free); }
    return new Promise((resolve) => waiters.push(resolve));
  }
  function release(slot) {
    const s = slots[slot.index];
    if (!s) return;
    const next = waiters.shift();
    if (next) { next(s); } // permanece busy, repassado ao próximo
    else { s.busy = false; }
  }
  return {
    acquire,
    release,
    size: slots.length,
    available: () => slots.filter((s) => !s.busy).length,
  };
}

// 'canon' (serializa no CANON e deixa refrescar) quando falta < slack p/ expirar
// ou não há expiresAt; 'pool' (worker isolado) quando há folga.
function decideRefreshMode(expiresAt, now, slackMs) {
  if (!expiresAt || expiresAt <= 0) return 'canon';
  return (expiresAt - now) < slackMs ? 'canon' : 'pool';
}

function workerHomePath(canonHome, i) {
  return `${canonHome}-w${i}`;
}

function needsCredSync(srcMtimeMs, dstMtimeMs) {
  if (dstMtimeMs == null) return true;
  return dstMtimeMs < srcMtimeMs;
}

module.exports = { createSemaphore, decideRefreshMode, workerHomePath, needsCredSync };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/ai/claude-pool.test.js`
Expected: 4 PASS.

---

### Task 2: `buildEnv(home)` parametrizado + constantes do pool em `claude.js`

**Files:**
- Modify: `src/ai/claude.js` (constantes no topo, ~linha 21-42; `buildEnv`, ~linha 44-54)

**Interfaces:**
- Consumes: `workerHomePath` da Task 1.
- Produces: `buildEnv(home)` (default = CANON, idêntico ao atual); constantes `PARALLEL_ENABLED`, `POOL_SIZE`, `REFRESH_SLACK_MS`, `WORKER_HOMES`.

- [ ] **Step 1: Adicionar constantes do pool após `CLAUDE_TIMEOUT_MS` (linha 34)**

Inserir após a linha do `CLAUDE_TIMEOUT_MS`:
```js
// Paralelismo (Fase 1, default OFF). Com a flag ≠ '1' tudo cai no caminho serial.
const { createSemaphore, decideRefreshMode, workerHomePath, needsCredSync } = require('./claude-pool');
const PARALLEL_ENABLED = process.env.TOM_CLAUDE_PARALLEL === '1';
const POOL_SIZE = Math.max(1, Number(process.env.TOM_CLAUDE_POOL_SIZE) || 2);
const REFRESH_SLACK_MS = Number(process.env.TOM_CLAUDE_REFRESH_SLACK_MS) || 1800000; // 30 min
const WORKER_HOMES = Array.from({ length: POOL_SIZE }, (_, i) => workerHomePath(CLAUDE_USER_HOME, i));
let _pool = null;        // semáforo, criado em ensureWorkerHomes()
let _canonLock = Promise.resolve(); // mutex SÓ para o refresh-no-CANON (Task 4)
```

- [ ] **Step 2: Parametrizar `buildEnv(home)`**

Trocar (hoje):
```js
function buildEnv() {
  const env = {
    HOME: CLAUDE_USER_HOME,
    PATH: CLAUDE_PATH,
    CLAUDE_HOME,
    LANG: process.env.LANG || 'C.UTF-8',
  };
```
por:
```js
function buildEnv(home = CLAUDE_USER_HOME) {
  const env = {
    HOME: home,
    PATH: CLAUDE_PATH,
    CLAUDE_HOME: path.join(home, '.claude'),
    LANG: process.env.LANG || 'C.UTF-8',
  };
```
(Para `home = CLAUDE_USER_HOME` o `CLAUDE_HOME` resultante = `CANON/.claude`, idêntico à constante atual.)

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/ai/claude.js`
Expected: exit 0.

---

### Task 3: `ensureWorkerHomes()` + `syncCredsToWorker()` (I/O, idempotente)

**Files:**
- Modify: `src/ai/claude.js` (novas funções perto do topo, após `buildEnv`)

**Interfaces:**
- Consumes: `needsCredSync`, `createSemaphore` (Task 1); `WORKER_HOMES`, `CLAUDE_HOME` (Task 2).
- Produces: `ensureWorkerHomes()` (cria HOMEs + popula `_pool`), `syncCredsToWorker(workerHome)`.

- [ ] **Step 1: Implementar `syncCredsToWorker` e `ensureWorkerHomes`**

Adicionar após `buildEnv`:
```js
// Copia o .credentials.json fresco do CANON → worker, só se o do worker estiver
// ausente/mais velho. NÃO copia .claude.json (cada worker tem o seu, descartável).
function syncCredsToWorker(workerHome) {
  const src = path.join(CLAUDE_HOME, '.credentials.json');
  const dstDir = path.join(workerHome, '.claude');
  const dst = path.join(dstDir, '.credentials.json');
  try {
    const srcMtime = fs.statSync(src).mtimeMs;
    let dstMtime = null;
    try { dstMtime = fs.statSync(dst).mtimeMs; } catch (_) { dstMtime = null; }
    if (needsCredSync(srcMtime, dstMtime)) {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(src, dst);
      try { fs.chmodSync(dst, 0o600); } catch (_) {}
    }
  } catch (e) {
    console.warn(`[Pool] syncCredsToWorker(${workerHome}) falhou: ${e.message}`);
  }
}

// Boot: cria os K worker HOMEs, faz a 1ª cópia das credenciais e monta o semáforo.
// Idempotente. Só roda quando o paralelismo está ligado.
function ensureWorkerHomes() {
  for (const home of WORKER_HOMES) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    syncCredsToWorker(home);
  }
  _pool = createSemaphore(WORKER_HOMES);
  console.log(`[Pool] ${WORKER_HOMES.length} worker HOMEs prontos (K=${POOL_SIZE})`);
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/ai/claude.js`
Expected: exit 0.

---

### Task 4: `getValidToken()` + roteamento `_chatParallel()`

**Files:**
- Modify: `src/ai/claude.js` (novas funções; `_chatInner`/`_spawnRaw` passam a receber `home`)

**Interfaces:**
- Consumes: `decideRefreshMode` (Task 1); `_pool`, `_canonLock`, `REFRESH_SLACK_MS`, `CLAUDE_HOME`, `CLAUDE_USER_HOME` (Task 2).
- Produces: `getValidToken() -> 'pool'|'canon'`; `_chatParallel(systemPrompt, messages, enqueuedAt)`.

- [ ] **Step 1: `_chatInner` e `_spawnRaw` aceitam `home` e o repassam a `buildEnv`**

Em `_chatInner`, mudar a assinatura (hoje `async function _chatInner(systemPrompt, messages, enqueuedAt) {`) para:
```js
async function _chatInner(systemPrompt, messages, enqueuedAt, home = CLAUDE_USER_HOME) {
```
e na chamada do `spawn` trocar `env: buildEnv(),` por `env: buildEnv(home),`.

Em `_spawnRaw`, mudar a assinatura (hoje `function _spawnRaw(systemPrompt, userPrompt) {`) para:
```js
function _spawnRaw(systemPrompt, userPrompt, home = CLAUDE_USER_HOME) {
```
e trocar `env: buildEnv(),` por `env: buildEnv(home),`.

- [ ] **Step 2: Implementar `getValidToken` e `_chatParallel`**

Adicionar (perto das funções do pool):
```js
// Lê o expiresAt do CANON e decide pool vs canon. Se não conseguir ler → 'canon' (seguro).
function getValidToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CLAUDE_HOME, '.credentials.json'), 'utf8'));
    const expiresAt = raw.claudeAiOauth?.expiresAt || 0;
    return decideRefreshMode(expiresAt, Date.now(), REFRESH_SLACK_MS);
  } catch (_) {
    return 'canon';
  }
}

// Caminho paralelo (flag ON). Token em folga → worker do pool; token perto de
// expirar → serializa no CANON (canonLock) e deixa o CLI refrescar por carona.
async function _chatParallel(systemPrompt, messages, enqueuedAt) {
  if (!_pool) ensureWorkerHomes();
  if (getValidToken() === 'canon') {
    const job = _canonLock.then(() => _chatInner(systemPrompt, messages, enqueuedAt, CLAUDE_USER_HOME));
    _canonLock = job.catch(() => {});
    return job;
  }
  const slot = await _pool.acquire();
  try {
    syncCredsToWorker(slot.home);
    return await _chatInner(systemPrompt, messages, enqueuedAt, slot.home);
  } finally {
    _pool.release(slot);
  }
}
```

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/ai/claude.js`
Expected: exit 0.

---

### Task 5: Integrar a flag em `chat()` e `chatRaw()`

**Files:**
- Modify: `src/ai/claude.js` (`chat`, ~linha 78; `chatRaw`, ~linha 345)

**Interfaces:**
- Consumes: `PARALLEL_ENABLED`, `_chatParallel` (Task 4), `_canonLock`.

- [ ] **Step 1: Rotear `chat()` pela flag (preservando o serial)**

Trocar (estado atual, pós fail-fast):
```js
async function chat(systemPrompt, messages, maxTokens) {
  const enqueuedAt = Date.now();
  const job = _claudeQueue.then(() => _chatInner(systemPrompt, messages, enqueuedAt));
  // Mantém a cadeia viva mesmo se este job rejeitar (catch silencioso só pra fila).
  _claudeQueue = job.catch(() => {});
  return job;
}
```
por:
```js
async function chat(systemPrompt, messages, maxTokens) {
  const enqueuedAt = Date.now();
  if (PARALLEL_ENABLED) {
    return _chatParallel(systemPrompt, messages, enqueuedAt);
  }
  // Caminho serial (flag OFF) — idêntico ao de hoje.
  const job = _claudeQueue.then(() => _chatInner(systemPrompt, messages, enqueuedAt));
  // Mantém a cadeia viva mesmo se este job rejeitar (catch silencioso só pra fila).
  _claudeQueue = job.catch(() => {});
  return job;
}
```

- [ ] **Step 2: Rotear `chatRaw()` pela flag**

Trocar (hoje):
```js
async function chatRaw(systemPrompt, userPrompt) {
  const job = _claudeQueue.then(() => _spawnRaw(systemPrompt, userPrompt));
  _claudeQueue = job.catch(() => {});
  const { rawResult, meta } = await job;
```
por:
```js
async function chatRaw(systemPrompt, userPrompt) {
  let job;
  if (PARALLEL_ENABLED) {
    if (!_pool) ensureWorkerHomes();
    if (getValidToken() === 'canon') {
      job = _canonLock.then(() => _spawnRaw(systemPrompt, userPrompt, CLAUDE_USER_HOME));
      _canonLock = job.catch(() => {});
    } else {
      job = (async () => {
        const slot = await _pool.acquire();
        try { syncCredsToWorker(slot.home); return await _spawnRaw(systemPrompt, userPrompt, slot.home); }
        finally { _pool.release(slot); }
      })();
    }
  } else {
    job = _claudeQueue.then(() => _spawnRaw(systemPrompt, userPrompt));
    _claudeQueue = job.catch(() => {});
  }
  const { rawResult, meta } = await job;
```

- [ ] **Step 3: Verificar sintaxe + testes existentes**

Run: `node --check src/ai/claude.js && node --test src/ai/claude.test.js src/ai/claude-pool.test.js`
Expected: exit 0; todos os testes PASS (buildArgs/stripModelHtml intactos + pool).

---

### Task 6: Canário de auth no boot + verificação na VPS

**Files:**
- Modify: `src/ai/claude.js` (exportar `ensureWorkerHomes`, `getValidToken` para o boot/diagnóstico)
- Verify (VPS): comportamento flag OFF idêntico; smoke flag ON.

- [ ] **Step 1: Exportar utilidades de boot**

No `module.exports` do `claude.js`, acrescentar `ensureWorkerHomes` e `getValidToken`:
```js
module.exports = { chat, chatRaw, buildArgs, stripModelHtml, ensureWorkerHomes, getValidToken };
```

- [ ] **Step 2: Deploy seguro (flag OFF) + provar que o serial é idêntico**

scp `claude.js` + `claude-pool.js` para a VPS; `pm2 restart tom`. Sem `TOM_CLAUDE_PARALLEL` no `.env`, o caminho é serial.
Run (VPS): `ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e \"const c=require('./src/ai/claude'); console.log('exports:', Object.keys(c).join(',')); console.log('getValidToken:', c.getValidToken());\""`
Expected: lista de exports inclui `ensureWorkerHomes,getValidToken`; `getValidToken` retorna `pool` ou `canon` sem lançar.

- [ ] **Step 3: Smoke do pool num HOME de teste (flag ON, sem tocar produção)**

Run (VPS): rodar um script que seta `TOM_CLAUDE_PARALLEL=1`, chama `ensureWorkerHomes()` e dispara 2 `chat()` simultâneos com prompt trivial; confirmar 2 respostas OK e `sha256(refreshToken do CANON)` igual antes/depois (CANON intacto — mesmo protocolo do Exp 3 da Fase 0).
Expected: 2 respostas, CANON intacto, `.claude.json` dos workers JSON válido (> 50 bytes).

---

## Fora deste plano — Fase 2 (ligar a flag), com gate

- **Gate de re-login (§6.1 da spec):** antes de ligar `TOM_CLAUDE_PARALLEL=1`, ensaiar com o Alf o `claude auth login --claudeai` (device-code) num HOME descartável, pra garantir que ele consegue recuperar a auth se precisar. **Sem isso validado, não ligar a flag.**
- **Ligar:** `TOM_CLAUDE_PARALLEL=1` no `.env` + `pm2 restart tom`, com o Alf presente, observando `pm2 logs` por ≥1 ciclo de refresh (~3h). Reversível: `TOM_CLAUDE_PARALLEL=0` + restart (segundos, sem deploy).
- **Exp 5 (rotação passiva):** classificar se o `refreshToken` rotaciona no refresh natural (confirmatório; o design já é robusto a rotação).

## Self-review

- **Cobertura da spec §5.2:** `buildEnv(home)` ✓ (T2), `ensureWorkerHomes` ✓ (T3), `getValidToken` ✓ (T4), `acquireSlot/releaseSlot` ✓ (semáforo, T1), `syncCredsToWorker` ✓ (T3), `canonLock` ✓ (`_canonLock`, T2/T4). Flag/K/slack ✓ (T2). Canário ✓ (T6).
- **Placeholders:** nenhum — código real em cada step.
- **Consistência de tipos:** `createSemaphore(homes).acquire() -> {home,index}` definido em T1 e consumido em T4/T5 com `.home`/`.index`; `decideRefreshMode/getValidToken` retornam `'pool'|'canon'` usados em T4/T5; `_chatInner(...,home)` e `_spawnRaw(...,home)` definidos em T4 e chamados em T4/T5.
- **Risco:** o caminho serial (flag OFF) fica intacto em `chat`/`chatRaw` (só um `if (PARALLEL_ENABLED)` antes). Maior risco = `_chatInner` ganhar o param `home` — mitigado pelo default `CLAUDE_USER_HOME` (serial usa o CANON, idêntico). Deploy é seguro porque a flag nasce OFF.
