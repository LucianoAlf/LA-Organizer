'use strict';
// Achado 19df16e2 (Anne, 25/09 20:46 → 26/09 00:04): o relato veio HORAS antes do eco. Falas reais.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ecoDoRelatoDoUsuario } = require('./eco-relato-usuario');
const { enforceNoMarkerHonesty, NO_MARKER_HONEST_NOTE } = require('./optimistic-confirm');

const RELATO_ANNE = 'Sim, Tom, pode avisar Vitória Andrade que eu já separei os cheques para devolução';
const ATUAL_ANNE = 'Tudo certo Tom';
const TOM_ANNE = '✅ Show, Anne. Dia fechado, e os cheques da Vitória já separados.\nBom descanso! ☕ Amanhã cedo eu te chamo.';

test('caso real da Anne: relato de 3h antes + eco no boa-noite -> é eco e a fala chega inteira', () => {
  const eco = ecoDoRelatoDoUsuario(ATUAL_ANNE, TOM_ANNE, { relatosRecentes: [RELATO_ANNE] });
  assert.strictEqual(eco, true);
  assert.strictEqual(enforceNoMarkerHonesty(TOM_ANNE, { nothingPersisted: true, reportedState: eco }), TOM_ANNE);
});

test('controle: sem os relatos recentes (o conserto de 24/09) a Anne continuava levando a nota', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(ATUAL_ANNE, TOM_ANNE), false);
  assert.ok(enforceNoMarkerHonesty(TOM_ANNE, { nothingPersisted: true, reportedState: false }).includes(NO_MARKER_HONEST_NOTE));
});

test('"dia fechado" não é escrita no sistema; "tarefa fechada" continua sendo', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario('já separei os cheques', '✅ Semana encerrada e os cheques separados'), true);
  assert.strictEqual(ecoDoRelatoDoUsuario('já separei os cheques', '✅ Tarefa dos cheques fechada'), false);
});

test('pedido NA FALA ATUAL desarma, mesmo com relato recente', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario('marca como feito aí', TOM_ANNE, { relatosRecentes: [RELATO_ANNE] }), false);
});

test('relato recente que também PEDIA registro não vale como fonte', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(ATUAL_ANNE, '✅ Cheques separados', { relatosRecentes: ['já separei os cheques, registra aí'] }), false);
});

test('relato recente sobre OUTRA coisa não cobre o eco (tem que retomar o relato)', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(ATUAL_ANNE, '✅ Show. Reunião com o fornecedor já feita.', { relatosRecentes: [RELATO_ANNE] }), false);
});

test('TOM falando da própria escrita continua pego com relato recente', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario(ATUAL_ANNE, '✅ Registrei os cheques separados', { relatosRecentes: [RELATO_ANNE] }), false);
});

test('sem fala atual mas com relato recente ainda funciona (boa-noite puxado pelo TOM)', () => {
  assert.strictEqual(ecoDoRelatoDoUsuario('', TOM_ANNE, { relatosRecentes: [RELATO_ANNE] }), true);
});

const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
test('engine busca as falas DELA das últimas 6h e passa pro detector', () => {
  assert.match(engine, /reportedState: ecoDoRelatoDoUsuario\(stripReplyScaffold\(String\(text \|\| ''\)\)\.userText, reply, \{ relatosRecentes: _relatosRecentes \}\)( \|\| linhasAcusadasSaoPergunta\(reply\))?,/);
  assert.match(engine, /\.eq\('direction', 'inbound'\)\s*\n\s*\.gte\('created_at', new Date\(_t0 - 6 \* 3600_000\)\.toISOString\(\)\)/);
});
