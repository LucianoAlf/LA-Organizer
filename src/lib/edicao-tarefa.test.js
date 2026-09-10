'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { lerEdicao, montarPatch } = require('./edicao-tarefa');

// Os 4 pedidos REAIS que caíram como schema_invalid (marker_logs, 26/07 → 09/09).
const YURI = { action: 'update', id: '5aaa3032', title: 'Ver chamada do Juliana com a Slyde' };
const DUDU_1 = { action: 'update', id: 'cbcb3f2b', notes: 'Unidade: Campo Grande. Itens: Cordas Guitarra/Violão/Contrabaixo · 2x capotraste' };
const DUDU_2 = { action: 'update', title: 'Teclado com defeito — Sala 7 Musicalização (Campo Grande)', notes: 'Modelo identificado: Casio LK-130. Apresenta defeito — precisa de verificação/conserto.' };
const ROSE = { action: 'update', id: '763eb1fc', assigned_group: 'Financeiro' };

test('Yuri: com id, o title é o NOME NOVO', () => {
  const e = lerEdicao(YURI);
  assert.strictEqual(e.id, '5aaa3032');
  assert.strictEqual(e.busca, null);
  assert.strictEqual(e.novoTitulo, 'Ver chamada do Juliana com a Slyde');
  const { patch, mudancas } = montarPatch(e, { title: 'Ver chamada da Juliana' });
  assert.deepStrictEqual(patch, { title: 'Ver chamada do Juliana com a Slyde' });
  assert.deepStrictEqual(mudancas, ['título']);
});

test('Dudu 09/09: sem id, o title é a tarefa de HOJE (pra achar), não um nome novo', () => {
  const e = lerEdicao(DUDU_2);
  assert.strictEqual(e.id, null);
  assert.strictEqual(e.busca, 'Teclado com defeito — Sala 7 Musicalização (Campo Grande)');
  assert.strictEqual(e.novoTitulo, '');
  assert.match(e.detalhe, /Casio LK-130/);
});

test('detalhe é ACRESCENTADO ao que já existe — nunca apaga o que a pessoa escreveu', () => {
  const { patch } = montarPatch(lerEdicao(DUDU_1), { title: 'Levantar itens', description: 'Pedido do Jereh.' });
  assert.strictEqual(patch.description, `Pedido do Jereh.\n${DUDU_1.notes}`);
});

test('detalhe que já está lá não duplica (repetir o pedido é inofensivo)', () => {
  const r = montarPatch(lerEdicao(DUDU_1), { title: 'x', description: `antes\n${DUDU_1.notes}` });
  assert.deepStrictEqual(r.mudancas, []);
});

test('Rose: mover pro grupo tira o responsável (o banco exige um dono só)', () => {
  const e = lerEdicao(ROSE);
  assert.strictEqual(e.grupo, 'Financeiro');
  const { patch, mudancas } = montarPatch(e, { title: 't', assigned_group_id: null }, { id: 'g-fin', name: 'Financeiro' });
  assert.deepStrictEqual(patch, { assigned_group_id: 'g-fin', assigned_to: null });
  assert.deepStrictEqual(mudancas, ['grupo Financeiro']);
});

test('já está no grupo → nada muda', () => {
  const r = montarPatch(lerEdicao(ROSE), { assigned_group_id: 'g-fin' }, { id: 'g-fin', name: 'Financeiro' });
  assert.deepStrictEqual(r.patch, {});
});

test('new_title vale com ou sem id; description e details são aceitos como detalhe', () => {
  assert.strictEqual(lerEdicao({ title: 'antigo', new_title: 'novo' }).novoTitulo, 'novo');
  assert.strictEqual(lerEdicao({ id: 'ab12cd34', description: 'x y' }).detalhe, 'x y');
  assert.strictEqual(lerEdicao({ id: 'ab12cd34', details: 'z' }).detalhe, 'z');
});

test('sem alvo ou sem nada pra mudar é recusado com motivo', () => {
  assert.deepStrictEqual(lerEdicao({ notes: 'x' }), { erro: 'bad_id' });
  assert.deepStrictEqual(lerEdicao({ title: 'só o nome, sem id e sem mudança' }), { erro: 'update:no_editable_field' });
  assert.deepStrictEqual(lerEdicao({ id: 'ab12cd34' }), { erro: 'update:no_editable_field' });
  assert.deepStrictEqual(lerEdicao(null), { erro: 'not_object' });
});

test('mesmo título que já tem não conta como mudança', () => {
  const r = montarPatch(lerEdicao({ id: 'ab12cd34', title: 'Igual' }), { title: 'Igual' });
  assert.deepStrictEqual(r.mudancas, []);
});

// ── LIGACAO NO ENGINE E NO PROMPT ─────────────────────────────────────────────────────
const _fs = require('node:fs');
const _path = require('node:path');
const ENG = _fs.readFileSync(_path.join(__dirname, '..', 'engine.js'), 'utf8');
const SYS = _fs.readFileSync(_path.join(__dirname, '..', 'prompts', 'system.js'), 'utf8');
test('engine: update é ação válida, validada e executada', () => {
  assert.match(ENG, /'snooze_reminders', 'return', 'update',/);
  assert.match(ENG, /\} else if \(a\.action === 'update'\) \{\s*\/\/ TASK-UPDATE-NAO-EXISTIA \(Alf 10\/09, opção A\)/);
  assert.match(ENG, /const \{ patch: _patch, mudancas \} = montarPatch\(ed, _full \|\| t, _grupo\);/);
});
test('prompt: ensina o update e diz que data/lembrete continuam no reschedule', () => {
  assert.match(SYS, /create\/complete\/reschedule\/update\/delegate/);
  assert.match(SYS, /action="update"[\s\S]{0,400}continuam em action="reschedule"/);
});
