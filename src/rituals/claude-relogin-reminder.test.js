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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runReloginReminder } = require('./claude-relogin-reminder');

function _tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relogin-'));
}
const DAY2 = 86400000;
const AT10 = new Date('2026-07-21T13:00:00Z'); // 10h BRT

// Fronteira 09h BRT inclusiva (flagged no review da Task 1) — função pura:
test('fronteira 09h BRT exato (inclusivo) → cutuca', () => {
  const at9 = Date.parse('2026-07-21T12:00:00Z'); // 09h BRT
  const d = decideReloginReminder({ lastReloginMs: at9 - 26 * DAY, lastReminderMs: null, nowMs: at9 });
  assert.strictEqual(d.remind, true);
  assert.strictEqual(d.reason, 'due');
});

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
