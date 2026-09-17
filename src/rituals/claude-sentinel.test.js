'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decideSentinel, buildSentinelMessage } = require('./claude-sentinel');

const NOW = Date.parse('2026-06-20T15:00:00Z'); // 12:00 em São Paulo (UTC-3, sem horário de verão)
const TRANSIENT_MS = 30 * 60 * 1000;
const REPAGE_MS = 3 * 60 * 60 * 1000;
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

// C4 (17/09, débito 16/09 20:40): incidente de AUTH re-alertado várias vezes (alerted_at virou
// "último alerta", não mais "primeiro") — a recuperação só pode pagar UMA VEZ mesmo assim; a
// regra é a mesma de sempre (alerted_at truthy → recover paga), só o VALOR de alerted_at mudou.
test('ok + incidente auth com alerted_at de um RE-ALERTA (não do primeiro) → recover paga só uma vez', () => {
  const d = decide(okProbe, { id: '1', kind: 'auth', started_at: '2026-06-20T09:00:00Z', alerted_at: '2026-06-20T14:59:00Z' });
  assert.strictEqual(d.action, 'recover');
  assert.strictEqual(d.page, true);
});

// ─── Auth morta ──────────────────────────────────────────────────────────────
test('auth + sem incidente → abre auth + page imediato', () => {
  const d = decide(authProbe, null);
  assert.strictEqual(d.action, 'open');
  assert.strictEqual(d.incidentKind, 'auth');
  assert.strictEqual(d.page, true);
  assert.strictEqual(d.pageType, 'auth');
});

test('auth + incidente auth aberto, alertado há 1h (< 3h) → noop (debounce, ainda não é hora de insistir)', () => {
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

// ─── C4 (17/09): AUTH insiste a cada 3h, só em horário comercial (09h–18h São Paulo) ───────────
// Débito real: alerta saiu 16/09 20:40, se perdeu entre outras mensagens, e o TOM ficou ~21h
// degradado no Codex sem ninguém saber. `alerted_at` passa a valer "último alerta" (reaproveitado
// — não é mais "primeiro alerta").
test('auth aberto, alertado há EXATAMENTE 3h, 12h em São Paulo → repage (insiste)', () => {
  const d = decideSentinel({
    probe: authProbe, nowMs: NOW, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T09:00:00Z', alerted_at: '2026-06-20T12:00:00Z' }, // 3h antes de NOW
  });
  assert.strictEqual(d.action, 'repage');
  assert.strictEqual(d.page, true);
  assert.strictEqual(d.pageType, 'auth');
});

test('auth aberto, alertado há 2h59min59s (< 3h), 12h em São Paulo → noop (ainda não venceu)', () => {
  const d = decideSentinel({
    probe: authProbe, nowMs: NOW, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T09:00:00Z', alerted_at: '2026-06-20T12:00:01Z' },
  });
  assert.strictEqual(d.action, 'noop');
  assert.strictEqual(d.page, false);
});

test('auth aberto, VENCEU o prazo de 3h, mas é NOITE em São Paulo (22h) → noop (nunca à noite)', () => {
  // 2026-06-21T01:00:00Z = 2026-06-20T22:00:00 em São Paulo
  const noite = Date.parse('2026-06-21T01:00:00Z');
  const d = decideSentinel({
    probe: authProbe, nowMs: noite, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T09:00:00Z', alerted_at: '2026-06-20T16:00:00Z' }, // 9h antes, bem vencido
  });
  assert.strictEqual(d.action, 'noop');
  assert.strictEqual(d.page, false);
});

test('auth aberto, VENCEU o prazo de 3h, mas é MADRUGADA (03h em São Paulo) → noop', () => {
  const madrugada = Date.parse('2026-06-20T06:00:00Z'); // 03:00 em São Paulo
  const d = decideSentinel({
    probe: authProbe, nowMs: madrugada, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-19T20:00:00Z', alerted_at: '2026-06-19T20:00:00Z' },
  });
  assert.strictEqual(d.action, 'noop');
});

test('janela: 08:59 em São Paulo → noop mesmo com prazo vencido (antes da janela abrir)', () => {
  const oitoE59 = Date.parse('2026-06-20T11:59:00Z'); // 08:59 em São Paulo
  const d = decideSentinel({
    probe: authProbe, nowMs: oitoE59, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T00:00:00Z', alerted_at: '2026-06-20T00:00:00Z' },
  });
  assert.strictEqual(d.action, 'noop');
});

test('janela: 09:00 em São Paulo → repage (janela já abriu), se o prazo também venceu', () => {
  const noveEmPonto = Date.parse('2026-06-20T12:00:00Z'); // 09:00 em São Paulo
  const d = decideSentinel({
    probe: authProbe, nowMs: noveEmPonto, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T00:00:00Z', alerted_at: '2026-06-20T00:00:00Z' },
  });
  assert.strictEqual(d.action, 'repage');
});

test('janela: 17:59 em São Paulo → repage (ainda dentro da janela), se o prazo venceu', () => {
  const dezessete59 = Date.parse('2026-06-20T20:59:00Z'); // 17:59 em São Paulo
  const d = decideSentinel({
    probe: authProbe, nowMs: dezessete59, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T00:00:00Z', alerted_at: '2026-06-20T00:00:00Z' },
  });
  assert.strictEqual(d.action, 'repage');
});

test('janela: 18:00 em São Paulo → noop (a janela fecha às 18h, não inclui)', () => {
  const dezoito = Date.parse('2026-06-20T21:00:00Z'); // 18:00 em São Paulo
  const d = decideSentinel({
    probe: authProbe, nowMs: dezoito, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T00:00:00Z', alerted_at: '2026-06-20T00:00:00Z' },
  });
  assert.strictEqual(d.action, 'noop');
});

test('auth aberto, NUNCA alertado (defensivo — não deveria acontecer), dentro da janela e prazo → repage', () => {
  const d = decideSentinel({
    probe: authProbe, nowMs: NOW, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T09:00:00Z', alerted_at: null },
  });
  assert.strictEqual(d.action, 'repage');
  assert.strictEqual(d.page, true);
});

test('sem repageMs configurado (caller não passou) → nunca insiste (fail-safe: some sem re-page, não deixa de nunca calar)', () => {
  const d = decideSentinel({
    probe: authProbe, nowMs: NOW, transientMs: TRANSIENT_MS,
    openIncident: { id: '1', kind: 'auth', started_at: '2026-06-20T00:00:00Z', alerted_at: '2026-06-20T00:00:00Z' },
  });
  assert.strictEqual(d.action, 'noop');
});

// ─── Transitório — CONTINUA IGUAL, o repage é só do auth ───────────────────────────────────────
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

// C4: prova de que o repage NÃO vaza pro transitório, mesmo com 3h+ desde o alerta e dentro da janela.
test('C4: transitório alertado há MAIS de 3h, dentro da janela → continua noop (repage é só do auth)', () => {
  const d = decideSentinel({
    probe: transientProbe, nowMs: NOW, transientMs: TRANSIENT_MS, repageMs: REPAGE_MS,
    openIncident: { id: '1', kind: 'transient', started_at: '2026-06-20T08:00:00Z', alerted_at: '2026-06-20T08:00:00Z' }, // 7h atrás
  });
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

// C4: a mensagem tem que DIZER há quanto tempo está fora do ar (não só a hora do relógio) — isso
// importa especialmente no re-page, senão o dono lê o mesmo texto de sempre e não sente a
// urgência de já ter passado 9h.
test('C4: mensagem auth com nowIso muito depois do sinceIso DIZ quantas horas já se passaram', () => {
  const m = buildSentinelMessage({
    pageType: 'auth', sinceIso: '2026-06-20T00:00:00Z', nowIso: '2026-06-20T09:00:00Z', reloginCmd: 'CMD',
  });
  assert.match(m, /9h/);
});

test('C4: mensagem auth do PRIMEIRO alerta (nowIso = sinceIso, 0h) não fala em duração', () => {
  const m = buildSentinelMessage({
    pageType: 'auth', sinceIso: '2026-06-20T09:00:00Z', nowIso: '2026-06-20T09:00:00Z', reloginCmd: 'CMD',
  });
  assert.ok(!/\(já se vão/.test(m));
});

test('C4: mensagem auth sem nowIso (chamada antiga) continua funcionando, sem duração', () => {
  const m = buildSentinelMessage({ pageType: 'auth', sinceIso: '2026-06-20T09:00:00Z', reloginCmd: 'CMD' });
  assert.match(m, /🔴/);
  assert.ok(!/\(já se vão/.test(m));
});
