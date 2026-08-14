const { test } = require('node:test');
const assert = require('node:assert');
const { matchSourceReply } = require('./source-match');

const listPayload = {
  form: 'list',
  candidates: [
    { kind: 'account', id: 'a1', name: 'Itaú' },
    { kind: 'card',    id: 'c1', name: 'Nubank' },
    { kind: 'cash',    id: null, name: 'Dinheiro' },
  ],
};

test('list: casa por número 1-based', () => {
  assert.deepStrictEqual(matchSourceReply('2', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});
test('list: casa por nome (substring, case-insensitive)', () => {
  assert.deepStrictEqual(matchSourceReply('no nubank', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});
test('list: "dinheiro" casa o candidato cash', () => {
  assert.deepStrictEqual(matchSourceReply('foi em dinheiro', listPayload), { kind: 'cash', id: null, name: 'Dinheiro' });
});
test('list: resposta off-topic não casa', () => {
  assert.strictEqual(matchSourceReply('amanhã te falo', listPayload), null);
});
test('list: 1ª palavra do nome casa ("salva no c6" → "C6 Bank")', () => {
  const pay = { form: 'list', candidates: [
    { kind: 'card', id: 'c6', name: 'C6 Bank' },
    { kind: 'card', id: 'nu', name: 'Nubank' },
  ] };
  assert.deepStrictEqual(matchSourceReply('salva no c6', pay), { kind: 'card', id: 'c6', name: 'C6 Bank' });
});
test('list: número fora do range não casa', () => {
  assert.strictEqual(matchSourceReply('9', listPayload), null);
});

const binaryPayload = {
  form: 'binary',
  account: { kind: 'account', id: 'a9', name: 'Nubank' },
  card:    { kind: 'card',    id: 'c9', name: 'Nubank' },
};

test('binary: "cartão" → card', () => {
  assert.deepStrictEqual(matchSourceReply('foi no cartão', binaryPayload), { kind: 'card', id: 'c9', name: 'Nubank' });
});
test('binary: "crédito" → card', () => {
  assert.deepStrictEqual(matchSourceReply('crédito', binaryPayload), { kind: 'card', id: 'c9', name: 'Nubank' });
});
test('binary: "conta"/"carteira"/"débito" → account', () => {
  assert.deepStrictEqual(matchSourceReply('na conta', binaryPayload), { kind: 'account', id: 'a9', name: 'Nubank' });
  assert.deepStrictEqual(matchSourceReply('foi no débito', binaryPayload), { kind: 'account', id: 'a9', name: 'Nubank' });
});
test('binary: ambíguo continua null', () => {
  assert.strictEqual(matchSourceReply('sei lá', binaryPayload), null);
});
test('texto vazio/longo não casa', () => {
  assert.strictEqual(matchSourceReply('', listPayload), null);
  assert.strictEqual(matchSourceReply('x'.repeat(250), listPayload), null);
});

// ---- guardas anti-falso-positivo (mensagem não-financeira com pending aberta) ----
test('não casa comando de tarefa com número ("marca reunião dia 2")', () => {
  assert.strictEqual(matchSourceReply('marca reunião dia 2 com o time', listPayload), null);
});
test('não casa "cria tarefa comprar 3 pilhas"', () => {
  assert.strictEqual(matchSourceReply('cria tarefa comprar 3 pilhas', listPayload), null);
});
test('não casa "liga pro joão amanhã"', () => {
  assert.strictEqual(matchSourceReply('liga pro joão amanhã', listPayload), null);
});
test('não casa frase longa com número ("to chegando em 2 min")', () => {
  assert.strictEqual(matchSourceReply('to chegando em 2 min', listPayload), null);
});
test('binary: não casa comando ("marca reunião na conta do cliente")', () => {
  assert.strictEqual(matchSourceReply('marca reunião na conta do cliente', binaryPayload), null);
});
test('ainda casa resposta curta com prefixo ("foi o 2")', () => {
  assert.deepStrictEqual(matchSourceReply('foi o 2', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});
test('ainda casa nome em resposta curta ("foi no nubank mesmo")', () => {
  assert.deepStrictEqual(matchSourceReply('foi no nubank mesmo', listPayload), { kind: 'card', id: 'c1', name: 'Nubank' });
});

// ── MATCHSOURCE-PREFIXO-GENERICO-CHUTA-ERRADO (14/08, achado testando o caso Rose ao vivo) ──
// A fixture acima usa nomes SEM prefixo ('Nubank'), mas em produção pf_cards.name TEM prefixo
// genérico ("Cartão Nubank", "Cartão Itaú" — confirmado no banco real). O `.find()` original
// checava full-name E primeira-palavra no MESMO predicado por candidato: ao chegar no 1º
// candidato da lista ("Cartão Itaú"), a checagem de 1ª-palavra ("cartão") já batia como token
// solto dentro de "cartão nubank" (a resposta do usuário) — e o `.find()` retornava Itaú ANTES
// de sequer testar o full-name match de Nubank, que seria PERFEITO.
//
// Resultado ao vivo: usuário respondeu "Cartão Nubank" (exato) e o sistema resolveu pro
// cartão ERRADO (Itaú) — silencioso, sem avisar, sem repetir pergunta. Pior que o loop: o
// loop pelo menos era visível.
const candsComPrefixo = [
  { kind: 'card', id: 'c-itau', name: 'Cartão Itaú' },
  { kind: 'card', id: 'c-nubank', name: 'Cartão Nubank' },
];

test('nome completo com prefixo genérico compartilhado casa o CERTO, não o primeiro da lista', () => {
  assert.deepStrictEqual(
    matchSourceReply('Cartão Nubank', { form: 'list', candidates: candsComPrefixo }),
    { kind: 'card', id: 'c-nubank', name: 'Cartão Nubank' }
  );
});

test('mesma coisa na ordem inversa da lista — não é sorte de posição', () => {
  const invertida = [candsComPrefixo[1], candsComPrefixo[0]];
  assert.deepStrictEqual(
    matchSourceReply('Cartão Itaú', { form: 'list', candidates: invertida }),
    { kind: 'card', id: 'c-itau', name: 'Cartão Itaú' }
  );
});

// Resposta só com a palavra genérica ("cartão", sem marca) não pode chutar o 1º da lista —
// é resposta explícita AMBÍGUA, mesma filosofia do "número fora do range não casa".
test('só a palavra genérica, sem marca nenhuma, NÃO casa (evita chute silencioso)', () => {
  assert.strictEqual(matchSourceReply('cartão', { form: 'list', candidates: candsComPrefixo }), null);
});
