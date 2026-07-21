'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decideSentinel, buildSentinelMessage } = require('./claude-sentinel');

const NOW = Date.parse('2026-06-20T15:00:00Z');
const TRANSIENT_MS = 30 * 60 * 1000;
const authProbe = { ok: false, kind: 'exit_auth' };
const transientProbe = { ok: false, kind: 'exit_overloaded' };
const okProbe = { ok: true };

const decide = (probe, openIncident) =>
  decideSentinel({ probe, openIncident, nowMs: NOW, transientMs: TRANSIENT_MS });

// ─── Claude OK ───────────────────────────────────────────────────────────────
test('ok + sem incidente → noop', () => {
  const d = decide(okProbe, null);
  assert.strictEqual(d.action, 'noop');
  assert.strictEqual(d.page, false);
});

test('ok + incidente auth alertado → recover COM page', () => {
  const d = decide(okProbe, { id: '1', kind: 'auth', started_at: '2026-06-20T14:00:00Z', alerted_at: '2026-06-20T14:00:00Z' });
  assert.strictEqual(d.action, 'recover');
  assert.strictEqual(d.page, true);
  assert.strictEqual(d.pageType, 'recover');
});

test('ok + incidente transitório NÃO alertado → recover SEM page (fecha em silêncio)', () => {
  const d = decide(okProbe, { id: '1', kind: 'transient', started_at: '2026-06-20T14:55:00Z', alerted_at: null });
  assert.strictEqual(d.action, 'recover');
  assert.strictEqual(d.page, false);
});

// ─── Auth morta ──────────────────────────────────────────────────────────────
test('auth + sem incidente → abre auth + page imediato', () => {
  const d = decide(authProbe, null);
  assert.strictEqual(d.action, 'open');
  assert.strictEqual(d.incidentKind, 'auth');
  assert.strictEqual(d.page, true);
  assert.strictEqual(d.pageType, 'auth');
});

test('auth + incidente auth aberto → noop (debounce, não re-paga)', () => {
  const d = decide(authProbe, { id: '1', kind: 'auth', started_at: '2026-06-20T14:00:00Z', alerted_at: '2026-06-20T14:00:00Z' });
  assert.strictEqual(d.action, 'noop');
  assert.strictEqual(d.page, false);
});

test('auth + incidente transitório aberto → escala p/ auth + page', () => {
  const d = decide(authProbe, { id: '1', kind: 'transient', started_at: '2026-06-20T14:00:00Z', alerted_at: null });
  assert.strictEqual(d.action, 'escalate');
  assert.strictEqual(d.incidentKind, 'auth');
  assert.strictEqual(d.page, true);
  assert.strictEqual(d.pageType, 'auth');
});

// ─── Transitório ─────────────────────────────────────────────────────────────
test('transitório + sem incidente → abre SEM page', () => {
  const d = decide(transientProbe, null);
  assert.strictEqual(d.action, 'open');
  assert.strictEqual(d.incidentKind, 'transient');
  assert.strictEqual(d.page, false);
});

test('transitório aberto recente (< 30min) não alertado → noop (ainda não paga)', () => {
  const d = decide(transientProbe, { id: '1', kind: 'transient', started_at: '2026-06-20T14:45:00Z', alerted_at: null }); // 15min
  assert.strictEqual(d.action, 'noop');
  assert.strictEqual(d.page, false);
});

test('transitório aberto persistente (>= 30min) não alertado → page_transient', () => {
  const d = decide(transientProbe, { id: '1', kind: 'transient', started_at: '2026-06-20T14:25:00Z', alerted_at: null }); // 35min
  assert.strictEqual(d.action, 'page_transient');
  assert.strictEqual(d.page, true);
  assert.strictEqual(d.pageType, 'transient');
});

test('transitório aberto JÁ alertado → noop (sem spam)', () => {
  const d = decide(transientProbe, { id: '1', kind: 'transient', started_at: '2026-06-20T13:00:00Z', alerted_at: '2026-06-20T14:00:00Z' });
  assert.strictEqual(d.action, 'noop');
});

test('transitório + incidente AUTH aberto → noop (já no estado pior)', () => {
  const d = decide(transientProbe, { id: '1', kind: 'auth', started_at: '2026-06-20T14:00:00Z', alerted_at: '2026-06-20T14:00:00Z' });
  assert.strictEqual(d.action, 'noop');
});

// ─── Mensagens ───────────────────────────────────────────────────────────────
test('mensagem auth tem 🔴 + comando de re-login', () => {
  const m = buildSentinelMessage({ pageType: 'auth', sinceIso: '2026-06-20T14:00:00Z', reloginCmd: 'CMD_RELOGIN' });
  assert.match(m, /🔴/);
  assert.match(m, /Codex/);
  assert.match(m, /CMD_RELOGIN/);
});

test('mensagem transient tem 🟠 e não despeja comando como protagonista', () => {
  const m = buildSentinelMessage({ pageType: 'transient', sinceIso: '2026-06-20T14:00:00Z' });
  assert.match(m, /🟠/);
  assert.match(m, /instável/i);
});

test('mensagem recover tem 🟢', () => {
  const m = buildSentinelMessage({ pageType: 'recover' });
  assert.match(m, /🟢/);
  assert.match(m, /voltou/i);
});

test('robustez: probe undefined → noop', () => {
  const d = decideSentinel({ probe: undefined, openIncident: null, nowMs: NOW, transientMs: TRANSIENT_MS });
  assert.strictEqual(d.action, 'noop');
});

test('auth message aponta pro wrapper tom-relogin.sh e mostra forma de-dentro-do-box', () => {
  const msg = buildSentinelMessage({
    pageType: 'auth',
    sinceIso: '2026-07-21T03:50:00Z',
    reloginCmd: 'ssh -t tom "/opt/LA-Organizer/scripts/tom-relogin.sh"',
  });
  assert.ok(msg.includes('/opt/LA-Organizer/scripts/tom-relogin.sh'));
  assert.ok(msg.includes('se já estiver dentro do box'));
});

test('DEFAULTS.reloginCmd (sem override) usa `bash` — protege o comando contra o reset do +x no deploy', () => {
  const msg = buildSentinelMessage({ pageType: 'auth', sinceIso: '2026-07-21T03:50:00Z' });
  assert.ok(msg.includes('bash /opt/LA-Organizer/scripts/tom-relogin.sh'));
});
