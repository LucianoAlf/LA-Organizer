'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pedeTotal, somaDaLista, falaJaTemTotal, textoTotal, formatarBRL } = require('./total-da-lista');

// As duas listas REAIS do turno da Rose (04/07). Os totais são os que o próprio TOM calculou:
// R$ 9.558,16 na primeira e R$ 9.914,32 na segunda (depois de a Light entrar com R$ 356,16).
const LISTA_1 = ['💰 *Contas Pessoais — Julho 2026*', '', '📅 *06/07*', '💳 Itaú Matheus → ⚠️ _(completar)_', '🏛️ IPTU → R$ 71,00', '',
  '📅 *10/07*', '💳 Latam Pass → R$ 6.008,04', '💳 Inter Matheus → ⚠️ _(completar)_', '', '📅 *11/07*', '💳 Itaú Rose → R$ 192,00', '',
  '📅 *13/07*', '🏥 Plano de Saúde → R$ 630,00', '', '📅 *14/07*', '💳 Nubank Rose → R$ 917,85',
  '📱 Mercado Pago Rose → R$ 363,00 _(⚠️ fecha 09/07)_', '📱 Mercado Pago Matheus → ⚠️ _(completar)_', '',
  '📅 *15/07*', '🌐 Internet Claro → R$ 200,00', '💡 Light → ⚠️ _(completar)_', '',
  '📅 *20/07*', '🏠 Financiamento → R$ 965,00', '🔥 Naturgy → R$ 211,27', '',
  '✅ *Total confirmado:* R$ 9.558,16'].join('\n');
const LISTA_2 = LISTA_1.replace('💡 Light → ⚠️ _(completar)_', '💡 Light → R$ 356,16').replace('✅ *Total confirmado:* R$ 9.558,16', '');
// A fala real que a Rose recebeu no lugar do total.
const FALA_SEM_TOTAL = 'Mas ainda faltam 4 valores (Itaú Matheus, Inter Matheus, MP Matheus e Light) — quando completar, o total real vai ser maior.';

test('Rose: o pedido dela nas duas formas conta; conversa comum não', () => {
  assert.strictEqual(pedeTotal('qual o total de contas ai?'), true);
  assert.strictEqual(pedeTotal('adiciona o total na lista'), true);
  assert.strictEqual(pedeTotal('soma isso pra mim'), true);
  assert.strictEqual(pedeTotal('o total confirmado ficou bom'), false);
  assert.strictEqual(pedeTotal('bom dia, tom'), false);
  assert.strictEqual(pedeTotal('qual a data de vencimento da Light?'), false); // pergunta sem total não conta
});

test('soma a lista real da Rose e bate com o número que o próprio TOM calculou', () => {
  const a = somaDaLista(LISTA_1);
  assert.strictEqual(a.total, 9558.16);
  assert.strictEqual(a.faltando, 4);
  const b = somaDaLista(LISTA_2);
  assert.strictEqual(b.total, 9914.32);
  assert.strictEqual(b.faltando, 3);
});

test('a linha que JÁ é total fica fora da conta (senão soma a si mesma)', () => {
  const semLinhaTotal = LISTA_1.replace('✅ *Total confirmado:* R$ 9.558,16', '');
  assert.strictEqual(somaDaLista(semLinhaTotal).total, somaDaLista(LISTA_1).total);
});

test('texto sem lista, ou com menos de 3 valores, não vira total', () => {
  assert.strictEqual(somaDaLista(FALA_SEM_TOTAL), null);
  assert.strictEqual(somaDaLista('paguei R$ 71,00 e R$ 192,00 hoje'), null);
  assert.strictEqual(somaDaLista(''), null);
});

test('a fala que já traz o total não recebe outro; a que não traz, recebe', () => {
  assert.strictEqual(falaJaTemTotal('💰 *Total parcial (confirmado):* R$ 9.914,32', 9914.32), true);
  assert.strictEqual(falaJaTemTotal(FALA_SEM_TOTAL, 9914.32), false);
});

test('formato e honestidade do que falta', () => {
  assert.strictEqual(formatarBRL(9914.32), 'R$ 9.914,32');
  assert.strictEqual(formatarBRL(71), 'R$ 71,00');
  assert.strictEqual(textoTotal({ total: 9914.32, faltando: 0 }), '💰 *Total: R$ 9.914,32*');
  assert.match(textoTotal({ total: 9914.32, faltando: 3 }), /3 itens ainda sem valor — o total real vai ser maior/);
  assert.match(textoTotal({ total: 71, faltando: 1 }), /1 item ainda sem valor/);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: pediu total e a fala não traz → o engine soma e anexa, antes da voz', () => {
  const i = ENG.indexOf('TOTAL-DA-LISTA-E-RESPOSTA');
  assert.ok(i > 0 && i < ENG.indexOf('  // ---- Sprint 28 — TOM Voice (TTS via ElevenLabs)'));
  assert.match(ENG, /if \(_totLista && !falaJaTemTotal\(reply, _totLista\.total\)\) \{/);
});
