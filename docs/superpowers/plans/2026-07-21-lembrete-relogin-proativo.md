# Lembrete proativo de re-login do Claude — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cutucar o dono no WhatsApp pra re-logar o Claude a cada ~25 dias em horário comercial, matando a janela em que o token da Max morre de madrugada e o TOM roda horas degradado no Codex.

**Architecture:** Uma função pura de decisão + mensagem (irmã da Sentinela reativa), um orquestrador fino que lê 2 marker files no box e manda o nag, um wrapper `tom-relogin.sh` que carimba o marker no re-login verificado, e um fix de texto na Sentinela reativa. Estado em arquivos fora do repo (sem migration). Ligado ao tick do dispatcher ao lado do `runClaudeSentinel`.

**Tech Stack:** Node.js CommonJS, `node:test`, `Intl.DateTimeFormat` (fuso), bash. Roda no VPS (`/opt/LA-Organizer`).

## Global Constraints

- **CommonJS** (`require` / `module.exports`), padrão dos rituais. Roda NO box (pode fs local).
- **Sem migration.** Estado = 2 marker files em `/opt/LA-Organizer/.claude-tom/` (`.last-relogin`, `.last-relogin-reminder`), fora do repo → sobrevivem ao `git reset --hard` do deploy.
- **Voz/comportamento do TOM intocados** — é alerta de dono/infra, não voz-de-colaborador.
- **Flag reversível:** `TOM_RELOGIN_REMINDER_ENABLED` (default `'1'`; `'0'` desliga). **Knob:** `TOM_RELOGIN_REMIND_DAYS` (default `25`). Telefone do dono: `TOM_OWNER_ALERT_PHONE` (default `'5521981278047'`).
- **Horário:** `startHour=9` inclusivo, `endHour=18` **exclusivo**, fuso `America/Sao_Paulo`. Dias **corridos** (vida do token é calendário). Hora via `Intl` com `hourCycle:'h23'` (evita o bug do "24" à meia-noite).
- **Test runner:** `node --test 'src/**/*.test.js'` (o `node --test src/` do node local trata dir como 1 teste → falso `fail 1`). Baseline local = `fail 2` (`system-loadout.test.js`, `pending-intents-detect.test.js` — falham por `.env`/`src/supabase` gitignored). Os testes NOVOS têm que passar; o resto continua igual.
- **Sem commit entre tasks.** `_remote` não é git repo; o Stop hook bundla no deploy. O **`.deploy-hold`** na raiz (`D:\la-organizer\.deploy-hold`) já está ATIVO protegendo o WIP — só a Task 5 (deploy cirúrgico) o remove.
- **Sentinela reativa é sagrada** exceto o texto: `decideSentinel` e `tom_provider_incidents` NÃO mudam.

---

### Task 1: Funções puras `decideReloginReminder` + `buildReminderMessage` (TDD, não deploya)

**Files:**
- Create: `src/rituals/claude-relogin-reminder.js`
- Test: `src/rituals/claude-relogin-reminder.test.js`

**Interfaces:**
- Produces:
  - `decideReloginReminder({ lastReloginMs:number|null, lastReminderMs:number|null, nowMs:number, thresholdDays?:number, startHour?:number, endHour?:number, tz?:string })` → `{ remind:boolean, daysSince:number|null, reason:'no-stamp'|'fresh'|'off-hours'|'already-today'|'due' }`
  - `buildReminderMessage({ daysSince:number })` → `string`
  - `_brtParts(ms:number, tz:string)` → `{ hour:number, date:'YYYY-MM-DD' }`
  - `DEFAULTS` object (ownerPhone, thresholdDays, startHour, endHour, tz, stampDir)

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/rituals/claude-relogin-reminder.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decideReloginReminder, buildReminderMessage } = require('./claude-relogin-reminder');

// Âncoras BRT: America/Sao_Paulo = UTC-3 (sem DST desde 2019).
// 2026-07-21T13:00:00Z = 10:00 BRT (dentro de 9-18). 2026-07-21T11:00:00Z = 08:00 BRT (fora).
const NOON_UTC = Date.parse('2026-07-21T13:00:00Z');   // 10h BRT
const DAY = 86400000;

test('sem carimbo → no-stamp, não cutuca', () => {
  const d = decideReloginReminder({ lastReloginMs: null, lastReminderMs: null, nowMs: NOON_UTC });
  assert.strictEqual(d.remind, false);
  assert.strictEqual(d.reason, 'no-stamp');
  assert.strictEqual(d.daysSince, null);
});

test('fresco (10d) → fresh, não cutuca', () => {
  const d = decideReloginReminder({ lastReloginMs: NOON_UTC - 10 * DAY, lastReminderMs: null, nowMs: NOON_UTC });
  assert.strictEqual(d.remind, false);
  assert.strictEqual(d.reason, 'fresh');
  assert.strictEqual(d.daysSince, 10);
});

test('devido (26d), 10h BRT, sem nag hoje → cutuca', () => {
  const d = decideReloginReminder({ lastReloginMs: NOON_UTC - 26 * DAY, lastReminderMs: null, nowMs: NOON_UTC });
  assert.strictEqual(d.remind, true);
  assert.strictEqual(d.reason, 'due');
  assert.strictEqual(d.daysSince, 26);
});

test('fronteira exata 25.0d, 10h BRT → cutuca (>=)', () => {
  const d = decideReloginReminder({ lastReloginMs: NOON_UTC - 25 * DAY, lastReminderMs: null, nowMs: NOON_UTC });
  assert.strictEqual(d.remind, true);
  assert.strictEqual(d.reason, 'due');
});

test('devido mas 08h BRT → off-hours', () => {
  const early = Date.parse('2026-07-21T11:00:00Z'); // 08h BRT
  const d = decideReloginReminder({ lastReloginMs: early - 26 * DAY, lastReminderMs: null, nowMs: early });
  assert.strictEqual(d.remind, false);
  assert.strictEqual(d.reason, 'off-hours');
});

test('devido mas 18h BRT → off-hours (limite exclusivo)', () => {
  const at18 = Date.parse('2026-07-21T21:00:00Z'); // 18h BRT
  const d = decideReloginReminder({ lastReloginMs: at18 - 26 * DAY, lastReminderMs: null, nowMs: at18 });
  assert.strictEqual(d.remind, false);
  assert.strictEqual(d.reason, 'off-hours');
});

test('devido mas já cutucou HOJE (mesma data BRT) → already-today', () => {
  const d = decideReloginReminder({
    lastReloginMs: NOON_UTC - 26 * DAY,
    lastReminderMs: Date.parse('2026-07-21T12:00:00Z'), // mesmo dia BRT (09h BRT)
    nowMs: NOON_UTC,
  });
  assert.strictEqual(d.remind, false);
  assert.strictEqual(d.reason, 'already-today');
});

test('devido, último nag foi ONTEM → cutuca', () => {
  const d = decideReloginReminder({
    lastReloginMs: NOON_UTC - 26 * DAY,
    lastReminderMs: NOON_UTC - 1 * DAY, // ontem, mesma hora
    nowMs: NOON_UTC,
  });
  assert.strictEqual(d.remind, true);
  assert.strictEqual(d.reason, 'due');
});

test('fuso: 23h UTC = 20h BRT → off-hours', () => {
  const at20 = Date.parse('2026-07-21T23:00:00Z'); // 20h BRT
  const d = decideReloginReminder({ lastReloginMs: at20 - 26 * DAY, lastReminderMs: null, nowMs: at20 });
  assert.strictEqual(d.reason, 'off-hours');
});

test('buildReminderMessage rende daysSince e o comando do wrapper', () => {
  const msg = buildReminderMessage({ daysSince: 27 });
  assert.ok(msg.includes('27 dias'));
  assert.ok(msg.includes('/opt/LA-Organizer/scripts/tom-relogin.sh'));
  assert.ok(msg.includes('renova o login do Claude'));
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd _remote && node --test src/rituals/claude-relogin-reminder.test.js`
Expected: FAIL — `Cannot find module './claude-relogin-reminder'`.

- [ ] **Step 3: Implementar o módulo (só as puras + DEFAULTS)**

Criar `src/rituals/claude-relogin-reminder.js`:

```js
// src/rituals/claude-relogin-reminder.js
// LEMBRETE PROATIVO DE RE-LOGIN — camada PREDITIVA sobre a Sentinela reativa
// (claude-sentinel.js). O token da Max morre ~mensal; se cai de madrugada o TOM
// roda horas no Codex. Aqui a gente cutuca o dono pra re-logar ANTES (em horário
// comercial), a cada ~25d. Estado = 2 marker files no box (sem banco/migration).
// Funções puras (decide/message) testadas isoladas.
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  ownerPhone: '5521981278047',            // Alf — override por TOM_OWNER_ALERT_PHONE
  thresholdDays: 25,                       // override por TOM_RELOGIN_REMIND_DAYS
  startHour: 9,                            // 9h BRT inclusivo
  endHour: 18,                             // 18h BRT EXCLUSIVO
  tz: 'America/Sao_Paulo',
  stampDir: '/opt/LA-Organizer/.claude-tom',
};

const RELOGIN_HINT = [
  'Renova agora — do teu terminal:',
  'ssh -t tom "/opt/LA-Organizer/scripts/tom-relogin.sh"',
  '(se já estiver dentro do box: /opt/LA-Organizer/scripts/tom-relogin.sh)',
].join('\n');

// hora (0-23) e data 'YYYY-MM-DD' no fuso — determinístico dado ms.
function _brtParts(ms, tz = DEFAULTS.tz) {
  const d = new Date(ms);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return { hour, date };
}

// ─── DECISÃO (pura) ──────────────────────────────────────────────────────────
function decideReloginReminder({
  lastReloginMs, lastReminderMs, nowMs,
  thresholdDays = DEFAULTS.thresholdDays,
  startHour = DEFAULTS.startHour, endHour = DEFAULTS.endHour, tz = DEFAULTS.tz,
} = {}) {
  if (lastReloginMs == null || !Number.isFinite(lastReloginMs)) {
    return { remind: false, daysSince: null, reason: 'no-stamp' };
  }
  const ageDays = (nowMs - lastReloginMs) / 86400000;
  const daysSince = Math.floor(ageDays);
  if (ageDays < thresholdDays) return { remind: false, daysSince, reason: 'fresh' };

  const nowParts = _brtParts(nowMs, tz);
  if (nowParts.hour < startHour || nowParts.hour >= endHour) {
    return { remind: false, daysSince, reason: 'off-hours' };
  }
  if (lastReminderMs != null && Number.isFinite(lastReminderMs)) {
    if (_brtParts(lastReminderMs, tz).date === nowParts.date) {
      return { remind: false, daysSince, reason: 'already-today' };
    }
  }
  return { remind: true, daysSince, reason: 'due' };
}

// ─── MENSAGEM (pura) ─────────────────────────────────────────────────────────
function buildReminderMessage({ daysSince } = {}) {
  return [
    '🔑 *TOM — renova o login do Claude (2 min)*',
    `Faz ${daysSince} dias do último re-login. O token da Max vive ~30 dias e, se passar, morre de madrugada e o TOM cai no Codex (degradado) até alguém re-logar.`,
    '',
    RELOGIN_HINT,
  ].join('\n');
}

module.exports = { decideReloginReminder, buildReminderMessage, _brtParts, DEFAULTS };
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd _remote && node --test src/rituals/claude-relogin-reminder.test.js`
Expected: PASS — `pass 10  fail 0`.

- [ ] **Step 5: Confirmar zero-regressão na suíte**

Run: `cd _remote && node --test 'src/**/*.test.js' 2>&1 | tail -5`
Expected: os 2 baselines de ambiente seguem falhando (`system-loadout`, `pending-intents-detect`), o novo arquivo passa, nada mais quebra.

---

### Task 2: Orquestrador `runReloginReminder` (I/O) + fiação no dispatcher

**Files:**
- Modify: `src/rituals/claude-relogin-reminder.js` (adicionar orquestrador + export)
- Modify: `src/rituals/dispatcher.js:3654` (logo após o bloco da Sentinela)
- Test: `src/rituals/claude-relogin-reminder.test.js` (adicionar testes do orquestrador com stampDir temporário)

**Interfaces:**
- Consumes: `decideReloginReminder`, `buildReminderMessage` (Task 1); `sendMessage` de `../services/whatsapp`.
- Produces: `runReloginReminder({ sendMessage:async(phone,msg)=>void, now?:Date, env?:object, stampDir?:string })` → `{ decision }` | `{ skipped }`. Lê `.last-relogin` e `.last-relogin-reminder` do `stampDir`, decide, se `remind` envia e carimba `.last-relogin-reminder`. NUNCA lança.

- [ ] **Step 1: Escrever os testes do orquestrador (falham)**

Adicionar ao fim de `src/rituals/claude-relogin-reminder.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runReloginReminder } = require('./claude-relogin-reminder');

function _tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relogin-'));
}
const DAY2 = 86400000;
const AT10 = new Date('2026-07-21T13:00:00Z'); // 10h BRT

test('orquestrador: carimbo velho (30d) → envia UMA vez e grava reminder', async () => {
  const dir = _tmpDir();
  fs.writeFileSync(path.join(dir, '.last-relogin'), new Date(AT10.getTime() - 30 * DAY2).toISOString());
  const sent = [];
  const r = await runReloginReminder({
    sendMessage: async (p, m) => sent.push({ p, m }),
    now: AT10, env: {}, stampDir: dir,
  });
  assert.strictEqual(r.decision.remind, true);
  assert.strictEqual(sent.length, 1);
  assert.ok(sent[0].m.includes('renova o login'));
  assert.ok(fs.existsSync(path.join(dir, '.last-relogin-reminder')));
});

test('orquestrador: segundo tick no MESMO dia → silêncio (dedup)', async () => {
  const dir = _tmpDir();
  fs.writeFileSync(path.join(dir, '.last-relogin'), new Date(AT10.getTime() - 30 * DAY2).toISOString());
  const sent = [];
  const send = async (p, m) => sent.push({ p, m });
  await runReloginReminder({ sendMessage: send, now: AT10, env: {}, stampDir: dir });
  const at11 = new Date('2026-07-21T14:00:00Z'); // 11h BRT, mesmo dia
  const r2 = await runReloginReminder({ sendMessage: send, now: at11, env: {}, stampDir: dir });
  assert.strictEqual(r2.decision.reason, 'already-today');
  assert.strictEqual(sent.length, 1); // não mandou de novo
});

test('orquestrador: sem carimbo → não envia', async () => {
  const dir = _tmpDir();
  const sent = [];
  const r = await runReloginReminder({ sendMessage: async (p, m) => sent.push({ p, m }), now: AT10, env: {}, stampDir: dir });
  assert.strictEqual(r.decision.reason, 'no-stamp');
  assert.strictEqual(sent.length, 0);
});

test('orquestrador: flag desligada → skipped', async () => {
  const dir = _tmpDir();
  fs.writeFileSync(path.join(dir, '.last-relogin'), new Date(AT10.getTime() - 30 * DAY2).toISOString());
  const sent = [];
  const r = await runReloginReminder({
    sendMessage: async (p, m) => sent.push({ p, m }),
    now: AT10, env: { TOM_RELOGIN_REMINDER_ENABLED: '0' }, stampDir: dir,
  });
  assert.strictEqual(r.skipped, 'disabled');
  assert.strictEqual(sent.length, 0);
});

test('orquestrador: envio quebra → não lança (engole)', async () => {
  const dir = _tmpDir();
  fs.writeFileSync(path.join(dir, '.last-relogin'), new Date(AT10.getTime() - 30 * DAY2).toISOString());
  await assert.doesNotReject(runReloginReminder({
    sendMessage: async () => { throw new Error('whatsapp down'); },
    now: AT10, env: {}, stampDir: dir,
  }));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/rituals/claude-relogin-reminder.test.js`
Expected: FAIL — `runReloginReminder is not a function`.

- [ ] **Step 3: Implementar o orquestrador**

Adicionar a `src/rituals/claude-relogin-reminder.js` ANTES do `module.exports`:

```js
// ─── ORQUESTRADOR (I/O) ──────────────────────────────────────────────────────
// Lê os markers, decide, e se cutuca manda no WhatsApp do dono + carimba o
// reminder (dedup 1x/dia). NUNCA propaga erro (o tick do dispatcher não pode
// quebrar por causa daqui).
function _readStamp(file) {
  try {
    const ms = Date.parse(String(fs.readFileSync(file, 'utf8')).trim());
    return Number.isFinite(ms) ? ms : null;
  } catch (_) { return null; }
}

async function runReloginReminder({ sendMessage, now = new Date(), env = process.env, stampDir = DEFAULTS.stampDir } = {}) {
  const enabled = String(env.TOM_RELOGIN_REMINDER_ENABLED ?? '1') !== '0';
  if (!enabled) return { skipped: 'disabled' };

  const ownerPhone = env.TOM_OWNER_ALERT_PHONE || DEFAULTS.ownerPhone;
  const thresholdDays = Number(env.TOM_RELOGIN_REMIND_DAYS) || DEFAULTS.thresholdDays;
  const nowMs = now.getTime();
  const reloginFile = path.join(stampDir, '.last-relogin');
  const reminderFile = path.join(stampDir, '.last-relogin-reminder');

  const lastReloginMs = _readStamp(reloginFile);
  const lastReminderMs = _readStamp(reminderFile);
  const decision = decideReloginReminder({ lastReloginMs, lastReminderMs, nowMs, thresholdDays });

  if (decision.remind) {
    try {
      await sendMessage(ownerPhone, buildReminderMessage({ daysSince: decision.daysSince }));
      fs.writeFileSync(reminderFile, now.toISOString());
    } catch (e) {
      console.error('[ReloginReminder] envio/carimbo falhou:', e.message);
    }
  }
  const age = lastReloginMs ? Math.floor((nowMs - lastReloginMs) / 86400000) + 'd' : 'sem-carimbo';
  console.log(`[ReloginReminder] relogin=${age} → ${decision.reason}${decision.remind ? ' (nag)' : ''}`);
  return { decision };
}
```

E trocar a linha do export para:

```js
module.exports = { runReloginReminder, decideReloginReminder, buildReminderMessage, _brtParts, DEFAULTS };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote && node --test src/rituals/claude-relogin-reminder.test.js`
Expected: PASS — `pass 15  fail 0`.

- [ ] **Step 5: Ligar no dispatcher (após o bloco da Sentinela)**

Em `src/rituals/dispatcher.js`, logo após a linha `} catch (err) { console.error('[Sentinel] outer err:', err.message); }` (fim do bloco da Sentinela, ~3654), inserir:

```js

  // Lembrete proativo de re-login (21/07) — cutuca o dono se o carimbo do último
  // re-login passa de ~25d, 1x/dia em horário comercial. Preditivo (evita a queda
  // de madrugada), complementa a Sentinela reativa acima. Estado em marker files.
  try {
    const { runReloginReminder } = require('./claude-relogin-reminder');
    const { sendMessage } = require('../services/whatsapp');
    await runReloginReminder({ sendMessage, now: new Date() });
  } catch (err) { console.error('[ReloginReminder] outer err:', err.message); }
```

- [ ] **Step 6: `node --check` no dispatcher**

Run: `cd _remote && node --check src/rituals/dispatcher.js`
Expected: sem saída (sintaxe OK).

---

### Task 3: Fix de texto na Sentinela reativa (aponta pro wrapper)

**Files:**
- Modify: `src/rituals/claude-sentinel.js` (`DEFAULTS.reloginCmd` linha ~30 + branch `auth` de `buildSentinelMessage` ~95-103)
- Test: `src/rituals/claude-sentinel.test.js` (adicionar 1 asserção de mensagem)

**Interfaces:**
- Consumes: nada novo.
- Produces: mesma API (`buildSentinelMessage`), só o texto do branch `auth` muda.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `src/rituals/claude-sentinel.test.js`:

```js
test('auth message aponta pro wrapper tom-relogin.sh e mostra forma de-dentro-do-box', () => {
  const { buildSentinelMessage } = require('./claude-sentinel');
  const msg = buildSentinelMessage({
    pageType: 'auth',
    sinceIso: '2026-07-21T03:50:00Z',
    reloginCmd: 'ssh -t tom "/opt/LA-Organizer/scripts/tom-relogin.sh"',
  });
  assert.ok(msg.includes('/opt/LA-Organizer/scripts/tom-relogin.sh'));
  assert.ok(msg.includes('se já estiver dentro do box'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/rituals/claude-sentinel.test.js`
Expected: FAIL — a asserção `se já estiver dentro do box` não passa (a msg atual não tem essa linha).

- [ ] **Step 3: Aplicar o fix de texto**

Em `src/rituals/claude-sentinel.js`, trocar o default do comando (linha ~30):

```js
  reloginCmd: 'ssh -t tom "/opt/LA-Organizer/scripts/tom-relogin.sh"',
```

E o branch `auth` de `buildSentinelMessage` (~95-103) por:

```js
  if (pageType === 'auth') {
    return [
      '🔴 *TOM — Claude caiu (login)*',
      `Desde ~${_hhmm(sinceIso)} o Claude tá recusando autenticação. O TOM continua respondendo, mas *degradado no Codex* (fallback).`,
      '',
      'Pra voltar ao normal é só re-logar (o script faz backup + verifica sozinho):',
      reloginCmd || DEFAULTS.reloginCmd,
      '(se já estiver dentro do box: /opt/LA-Organizer/scripts/tom-relogin.sh)',
    ].join('\n');
  }
```

- [ ] **Step 4: Rodar e ver passar (Sentinela inteira)**

Run: `cd _remote && node --test src/rituals/claude-sentinel.test.js`
Expected: PASS — todos os testes da Sentinela + o novo passam. `decideSentinel` intacto.

---

### Task 4: Wrapper `scripts/tom-relogin.sh`

**Files:**
- Create: `scripts/tom-relogin.sh`

**Interfaces:**
- Produces: script que faz backup + login + canário + carimba `/opt/LA-Organizer/.claude-tom/.last-relogin`. Consumido manualmente pelo dono (e ensinado pela Sentinela/lembrete).

- [ ] **Step 1: Criar o script**

Criar `scripts/tom-relogin.sh`:

```bash
#!/usr/bin/env bash
# Re-login turnkey e auto-verificável do Claude CLI do TOM.
# Faz backup, loga (paste-back no TTY), verifica com canário REAL (não confia no
# "Login successful" da tela) e só então carimba o marker que zera o lembrete.
set -euo pipefail

export HOME=/opt/LA-Organizer/.claude-tom
CRED="$HOME/.claude/.credentials.json"
STAMP="$HOME/.last-relogin"

# 1) backup das credenciais atuais (se existirem)
if [ -f "$CRED" ]; then
  cp -a "$CRED" "$CRED.bak.$(date +%s)"
  echo "🗂️  backup: $CRED.bak.*"
fi

# 2) login interativo (imprime URL → autoriza no browser → cola o código aqui)
claude auth login --claudeai

# 3) canário REAL — a verdade (auth status MENTE)
if timeout 60 claude -p ok >/dev/null 2>&1; then
  date -Iseconds > "$STAMP"
  echo "✅ Re-login verificado (canário ok). Lembrete zerado: $(cat "$STAMP")"
else
  echo "❌ Canário falhou após o login — NÃO carimbei. Rode 'HOME=$HOME claude -p ok' e veja o erro." >&2
  exit 1
fi
```

- [ ] **Step 2: Checar a sintaxe do bash**

Run: `bash -n _remote/scripts/tom-relogin.sh`
Expected: sem saída (sintaxe OK). (Não dá pra rodar de verdade — o login é interativo com browser; a execução real é no deploy/uso do dono.)

---

### Task 5: Deploy cirúrgico + seed + dry-run + registrar (CATRACA executa — não delega)

**Files:**
- Deploy: `src/rituals/claude-relogin-reminder.js`, `src/rituals/dispatcher.js`, `src/rituals/claude-sentinel.js`, `scripts/tom-relogin.sh` → VPS
- Runtime: seed `/opt/LA-Organizer/.claude-tom/.last-relogin`; remover `.deploy-hold`

**Interfaces:**
- Consumes: tudo das Tasks 1-4, verde local.

- [ ] **Step 1: Suíte local completa verde (menos os 2 baselines de ambiente)**

Run: `cd _remote && node --test 'src/**/*.test.js' 2>&1 | tail -6`
Expected: `fail 2` (só `system-loadout` + `pending-intents-detect`), os novos arquivos passam.

- [ ] **Step 2: SCP dos arquivos pro box + chmod no wrapper**

```bash
scp _remote/src/rituals/claude-relogin-reminder.js tom:/opt/LA-Organizer/src/rituals/claude-relogin-reminder.js
scp _remote/src/rituals/dispatcher.js              tom:/opt/LA-Organizer/src/rituals/dispatcher.js
scp _remote/src/rituals/claude-sentinel.js         tom:/opt/LA-Organizer/src/rituals/claude-sentinel.js
scp _remote/scripts/tom-relogin.sh                 tom:/opt/LA-Organizer/scripts/tom-relogin.sh
ssh tom "chmod +x /opt/LA-Organizer/scripts/tom-relogin.sh"
```

- [ ] **Step 3: `node --check` + testes puros NO box**

```bash
ssh tom 'cd /opt/LA-Organizer && node --check src/rituals/dispatcher.js && node --check src/rituals/claude-relogin-reminder.js && node --test src/rituals/claude-relogin-reminder.test.js src/rituals/claude-sentinel.test.js 2>&1 | tail -5'
```
Expected: sintaxe OK; `fail 0` nos 2 arquivos de teste.

- [ ] **Step 4: Dry-run do orquestrador NO box (sem tocar no telefone do Alf)**

Usa um stampDir temporário com carimbo de 30d e um `sendMessage` que só imprime:
```bash
ssh tom 'cd /opt/LA-Organizer && node -e "
const { runReloginReminder } = require(\"./src/rituals/claude-relogin-reminder\");
const fs=require(\"fs\"),os=require(\"os\"),path=require(\"path\");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),\"dry-\"));
fs.writeFileSync(path.join(dir,\".last-relogin\"), new Date(Date.now()-30*86400000).toISOString());
const now=new Date(); now.setUTCHours(13,0,0,0); // 10h BRT
(async()=>{
  const r1=await runReloginReminder({sendMessage:async(p,m)=>console.log(\"WOULD SEND →\",p,\"\n\"+m),now,env:{},stampDir:dir});
  console.log(\"decisao1:\",r1.decision.reason,r1.decision.remind);
  const r2=await runReloginReminder({sendMessage:async()=>console.log(\"WOULD SEND (2)\"),now,env:{},stampDir:dir});
  console.log(\"decisao2:\",r2.decision.reason,r2.decision.remind);
})();
"'
```
Expected: 1ª decisão `due true` + o texto do nag impresso; 2ª decisão `already-today false` (dedup no mesmo dia). Nenhum WhatsApp real enviado.

- [ ] **Step 5: Seed do marker REAL (baseline = re-login de hoje 21/07)**

```bash
ssh tom 'date -Iseconds > /opt/LA-Organizer/.claude-tom/.last-relogin && echo "seed: $(cat /opt/LA-Organizer/.claude-tom/.last-relogin)"'
```
Expected: imprime o timestamp de hoje → 1º disparo do lembrete ~15/08.

- [ ] **Step 6: Restart do engine (pega a mudança de texto da Sentinela + a fiação)**

```bash
ssh tom "pm2 restart tom" && sleep 3 && ssh tom "pm2 jlist" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).find(p=>p.name==='tom');console.log('tom',t.pm2_env.status,'restarts='+t.pm2_env.restart_time)})"
```
Expected: `tom online`.

- [ ] **Step 7: Confirmar o lembrete rodando limpo no próximo tick (log)**

```bash
ssh tom 'sleep 60; grep -a "ReloginReminder" /opt/LA-Organizer/logs/tom-out.log | tail -3'
```
Expected: uma linha `[ReloginReminder] relogin=0d → fresh` (recém-seedado, não cutuca).

- [ ] **Step 8: Remover o `.deploy-hold` (libera o Stop hook a commitar/pushar o bundle)**

```bash
rm -f D:/la-organizer/.deploy-hold && echo "hold removido"
```

- [ ] **Step 9: Registrar no `tom_known_issues` + memória**

Registrar KI `CLAUDE-RELOGIN-PROACTIVE` (área `health-check`, status `corrigido`): a mitigação da recorrência mensal do refresh token via lembrete proativo. Atualizar a memória `reference_tom_cli_auth_relogin` com o wrapper + o lembrete no ar.

---

## Notas de execução
- **Tasks 1-4:** subagent-driven (Sonnet nas mecânicas; funções puras e wrapper são isolados). **Task 5 é minha (Catraca)** — deploy cirúrgico não delega.
- **Não commitar entre tasks** — o Stop hook bundla quando eu remover o `.deploy-hold` na Task 5.
