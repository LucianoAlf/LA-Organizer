'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildReminderNotice } = require('./reminder-notice');

// Caso Rafinha, 10/08 20:22 BRT (audit 0509fddb): "Quarta feira me lembra 07h da manhã conserto
// máquina lavar" → menu de duplicidade → "2" → "✅ Anotado: *Consertar máquina de lavar* — até
// 2026-08-12." O remind_at nasceu CERTO (07h BRT, conferido no banco), mas a confirmação do ramo
// de dup-bypass omite a hora, e a pessoa fica sem saber se o lembrete existe. O helper já resolve
// isso no ramo de marker (engine.js ~11433) — o ramo de dup-bypass é que não o chamava.

const REPLY_REAL = '✅ Anotado: *Consertar máquina de lavar* — até 2026-08-12.';
const REMIND_REAL = '2026-08-12T07:00:00-03:00';

test('helper devolve a hora do lembrete para a resposta real do dup-bypass', () => {
  assert.strictEqual(buildReminderNotice([REMIND_REAL], REPLY_REAL), '🔔 Lembro às 7h.');
});

test('controle: não duplica quando a resposta já cita a hora', () => {
  assert.strictEqual(buildReminderNotice([REMIND_REAL], '✅ Anotado: *Consertar máquina de lavar* — quarta às 7h.'), null);
});

test('ramo de dup-bypass da criação de tarefa anexa a hora do lembrete', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  const ini = src.indexOf("[DupBypass] task choice=");
  assert.ok(ini > 0, 'ramo de dup-bypass de task não encontrado no engine.js');
  const fim = src.indexOf('✅ Anotado: *${inserted?.title || tk.title}*', ini);
  assert.ok(fim > ini, 'confirmação do dup-bypass não encontrada no engine.js');
  const bloco = src.slice(ini, fim + 400);
  assert.ok(bloco.includes('buildReminderNotice'), 'ramo de dup-bypass não chama buildReminderNotice — a hora do lembrete some da confirmação');
});
