'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { escolherDuplicatas } = require('./bill-duplicata');

// Matheus 08/09 (8c38ae2f): as duas contas reais — nomes só diferem na caixa/acento.
const ORIGINAL = { id: 'cd69', name: 'LÉO MARCENEIRO', amount: '500.00', due_day: 10, created_at: '2026-07-11T11:28:33Z' };
const COPIA = { id: '3411', name: 'LéO Marceneiro', amount: 500, due_day: 10, created_at: '2026-08-17T11:37:16Z' };

test('Matheus: entre as duas cópias fica a mais antiga e sai a nova', () => {
  assert.deepStrictEqual(escolherDuplicatas([COPIA, ORIGINAL]), { manter: ORIGINAL, remover: [COPIA] });
});

test('valor ou dia diferente não é cópia — pergunta (null)', () => {
  assert.strictEqual(escolherDuplicatas([ORIGINAL, { ...COPIA, amount: 450 }]), null);
  assert.strictEqual(escolherDuplicatas([ORIGINAL, { ...COPIA, due_day: 15 }]), null);
});

test('três cópias: fica uma, saem duas; outra conta parecida não entra', () => {
  const tres = { ...COPIA, id: 'x3', created_at: '2026-09-01T00:00:00Z' };
  const outra = { id: 'o', name: 'Léo Marceneiro extra', amount: 120, due_day: 10, created_at: '2026-01-01T00:00:00Z' };
  const r = escolherDuplicatas([tres, COPIA, outra, ORIGINAL]);
  assert.deepStrictEqual([r.manter.id, r.remover.map((b) => b.id)], ['cd69', ['3411', 'x3']]);
});

test('dois grupos de cópias ao mesmo tempo → não adivinha (null)', () => {
  const a2 = { ...ORIGINAL, id: 'a2', created_at: '2026-08-01T00:00:00Z' };
  const b1 = { id: 'b1', name: 'Gás', amount: 150, due_day: 10, created_at: '2026-07-01T00:00:00Z' };
  const b2 = { ...b1, id: 'b2', created_at: '2026-08-01T00:00:00Z' };
  assert.strictEqual(escolherDuplicatas([ORIGINAL, a2, b1, b2]), null);
});

test('uma conta só não é duplicata', () => {
  assert.strictEqual(escolherDuplicatas([ORIGINAL]), null);
  assert.strictEqual(escolherDuplicatas([]), null);
});

const _fs = require('node:fs');
const _p = require('node:path');
const ENG = _fs.readFileSync(_p.join(__dirname, '..', 'engine.js'), 'utf8');
const SYS = _fs.readFileSync(_p.join(__dirname, '..', 'prompts', 'system.js'), 'utf8');
const SVC = _fs.readFileSync(_p.join(__dirname, '..', 'services', 'financeiro-service.js'), 'utf8');
test('engine: delete_bill com duplicate tira só as cópias e nunca apaga a única que sobrou', () => {
  assert.match(ENG, /const _dupPedida = params\.duplicate === true \|\| params\.duplicata === true \|\| params\.keep_one === true;/);
  assert.match(ENG, /if \(_dupPedida && cands\.length === 1\) return `Só tem uma \*\$\{cands\[0\]\.name\}\* cadastrada/);
  assert.match(ENG, /escolherDuplicatas\(cands\)/);
});
test('serviço traz dia e criação; prompt ensina o duplicate', () => {
  assert.match(SVC, /\.select\('id, name, amount, category, type, recurrence, due_day, created_at'\)/);
  assert.match(SYS, /"action":"delete_bill","params":\{"bill_name":"<nome da conta>","duplicate":true\}/);
});
