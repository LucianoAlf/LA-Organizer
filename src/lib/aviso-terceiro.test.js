'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { registrarAviso } = require('./aviso-terceiro');

test('grava no histórico de quem recebe, pelo id', async () => {
  const gravado = [];
  const ok = await registrarAviso({ log: async (...a) => gravado.push(a) }, { collaboratorId: 'r1', content: '✅ aprovada' });
  assert.strictEqual(ok, true);
  assert.deepStrictEqual(gravado, [['r1', 'outbound', '✅ aprovada']]);
});
test('payload antigo só com telefone: resolve o id pelo telefone (caso Rafinha 02/10)', async () => {
  const gravado = [];
  const ok = await registrarAviso(
    { log: async (...a) => gravado.push(a), idPorTelefone: async (p) => (p === '5521900000000' ? 'rafinha' : null) },
    { collaboratorId: null, phone: '5521900000000', content: '✅ Sua solicitação de manutenção foi aprovada' });
  assert.strictEqual(ok, true);
  assert.strictEqual(gravado[0][0], 'rafinha');
});
test('sem cadastro ou falha de gravação: não lança, devolve false', async () => {
  assert.strictEqual(await registrarAviso({ log: async () => {}, idPorTelefone: async () => null }, { phone: 'x', content: 'oi' }), false);
  assert.strictEqual(await registrarAviso({ log: async () => { throw new Error('db'); } }, { collaboratorId: 'a', content: 'oi' }), false);
});

// Catraca: todo envio do engine pra OUTRA pessoa grava no histórico dela. Censo pelo fonte.
// Exceção: alerta de estoque pra responsável de loja (não é colaborador, não tem histórico).
test('censo: nenhum aviso a terceiro no engine fica fora do histórico', () => {
  const L = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8').split('\n');
  const fora = [];
  L.forEach((l, i) => {
    if (!/whatsapp\.sendMessage\(/.test(l) || /sendMessage\((phone|collab\.phone),/.test(l)) return;
    if (/res\.whatsapp, alertMsg/.test(l)) return;
    const janela = L.slice(Math.max(0, i - 3), i + 8).join(' ');
    if (!/logConversation|conversation_history|proactiveLink|sendAndLink|_registrarAvisoNoHistorico/.test(janela)) fora.push(`${i + 1}: ${l.trim().slice(0, 80)}`);
  });
  assert.deepStrictEqual(fora, []);
});
test('pedido de manutenção só conta como enviado se o WhatsApp não falhou', () => {
  const E = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(E, /if \(_maintEnviado\) _metrics\.envio_deterministico/);
});
