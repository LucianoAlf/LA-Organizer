'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { pedeOQueFalta, faltaLancar, textoFaltaLancar } = require('./falta-lancar');

// Rose 14/07 (9151a290) — as duas falas reais, com a fatura de 62 itens aguardando "lançar".
test('Rose: as duas falas pedem pra VER o que falta — e "lança" não', () => {
  assert.strictEqual(pedeOQueFalta('tom, discrimina pra mimo que falta lançar da fatura'), true);
  assert.strictEqual(pedeOQueFalta('Tom, tem alguns lançamentos lá já, tem que ver o que ja tem p n duplicar'), true);
  assert.strictEqual(pedeOQueFalta('confere antes pra não duplicar'), true);
  assert.strictEqual(pedeOQueFalta('lança'), false);
  assert.strictEqual(pedeOQueFalta('cartão LATAM PASS'), false);
});

const ITENS = [
  { data: '2026-05-19', descricao: 'MP*BEBEDOPAPAI 02/02', valor: 132.45 },
  { data: '2026-05-20', descricao: 'AMAZON MARKETP 02/03', valor: 27.12 },
  { data: '2026-06-02', descricao: 'FESTRIO', valor: 35.99 },
  { data: '2026-06-03', descricao: 'Kilograma', valor: 57.45 },
];
const CHAVES = ['k1', 'k2', 'k3', 'k4'];

test('separa: já veio de fatura (chave), parece lançado à mão (valor+data ±3 dias) e falta', () => {
  const r = faltaLancar(ITENS, CHAVES, new Set(['k1']), [{ amount: 35.99, transaction_date: '2026-06-04' }, { amount: 999, transaction_date: '2026-06-03' }]);
  assert.strictEqual(r.pelaFatura, 1);
  assert.deepStrictEqual(r.porValor.map((i) => i.descricao), ['FESTRIO']);
  assert.deepStrictEqual(r.faltam.map((i) => i.descricao), ['AMAZON MARKETP 02/03', 'Kilograma']);
});

test('lançamento à mão só casa UMA vez (dois itens iguais, um lançamento → um falta)', () => {
  const dois = [{ data: '2026-06-03', descricao: 'Uber', valor: 20 }, { data: '2026-06-03', descricao: 'Uber', valor: 20 }];
  const r = faltaLancar(dois, [null, null], new Set(), [{ amount: 20, transaction_date: '2026-06-03' }]);
  assert.strictEqual(r.porValor.length, 1);
  assert.strictEqual(r.faltam.length, 1);
});

test('lançamento que veio de fatura (tem import_key) não conta como "à mão"; fora da janela também não', () => {
  const r = faltaLancar([ITENS[3]], ['kx'], new Set(), [{ amount: 57.45, transaction_date: '2026-06-03', import_key: 'outra' }, { amount: 57.45, transaction_date: '2026-06-20' }]);
  assert.strictEqual(r.faltam.length, 1);
});

test('texto: diz o que falta pelo nome, avisa que o "lançar" não pula o que foi à mão, e fecha certo quando está tudo lançado', () => {
  const r = faltaLancar(ITENS, CHAVES, new Set(['k1']), [{ amount: 35.99, transaction_date: '2026-06-04' }]);
  const t = textoFaltaLancar(r, 'Latam PASS');
  assert.match(t, /^📋 \*Latam PASS\* — 4 itens: \*1 já lançados pela fatura\*, \*1 parecem lançados à mão\* e \*faltam 2\*\./);
  assert.match(t, /1\. 20\/05 · AMAZON MARKETP 02\/03 · R\$ 27,12/);
  assert.match(t, /o \*lançar\* NÃO pula/);
  const tudo = faltaLancar(ITENS, CHAVES, new Set(CHAVES), []);
  assert.match(textoFaltaLancar(tudo, 'X'), /Tá tudo lançado/);
});

const ENG = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
test('engine: pedido de ver o que falta, com a fatura aguardando, responde sem fechar a fatura', () => {
  assert.match(ENG, /if \(!_decision && pedeOQueFalta\(text\)\) \{/);
  assert.match(ENG, /statementParse\.buildImportKeys\(_payF\.itens, \{ cardId: _payF\.card_id, competencia: _compF \}\)/);
});
