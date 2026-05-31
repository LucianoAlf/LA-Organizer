const { test } = require('node:test');
const assert = require('node:assert');
const { CAT_META, buildTxnFooter, buildTxnConfirmation, buildSourceQuestion, SEP } = require('./finance-format');

// ---- CAT_META ----
test('CAT_META cobre todas as categorias do schema com emoji e label', () => {
  for (const k of ['salario','comissao','extra','moradia','alimentacao','transporte','saude','educacao','lazer','outros']) {
    assert.ok(CAT_META[k] && CAT_META[k].emoji && CAT_META[k].label, `CAT_META[${k}] incompleto`);
  }
});

// ---- buildTxnFooter (contextual, só comando que funciona) ----
test('footer: sem categoria ensina a dizer categoria', () => {
  const f = buildTxnFooter({ categoryMissing: true, accountLinked: true, tipSeed: 0 });
  assert.match(f, /categoria/i);
  assert.match(f, /^_/m);
});
test('footer: com categoria e sem carteira ensina de onde saiu', () => {
  const f = buildTxnFooter({ categoryMissing: false, accountLinked: false, tipSeed: 0 });
  assert.match(f, /de onde saiu/i);
});
test('footer: completo dá dica rotativa determinística pelo seed', () => {
  const a = buildTxnFooter({ categoryMissing: false, accountLinked: true, tipSeed: 0 });
  const b = buildTxnFooter({ categoryMissing: false, accountLinked: true, tipSeed: 1 });
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, buildTxnFooter({ categoryMissing: false, accountLinked: true, tipSeed: 0 }));
});
test('footer NUNCA ensina edição/correção (não existe ação ainda)', () => {
  const fs = [0,1,2,3].map((s)=>buildTxnFooter({categoryMissing:false,accountLinked:true,tipSeed:s}))
    .concat(buildTxnFooter({categoryMissing:true,accountLinked:false,tipSeed:0}));
  for (const f of fs) assert.doesNotMatch(f, /era \d|muda pra|apaga|exclui/i);
});

// ---- buildTxnConfirmation (gramática do cartão: header, SEP, atributos, SEP, saldo) ----
test('gasto com carteira: header, separadores, atributos e saldo negativo', () => {
  const card = buildTxnConfirmation({
    type:'expense', description:'iFood', amount:45, categoryLabel:'Alimentação',
    account:{name:'Nubank', icon:'💜'}, newBalance:-45, budgetBlock:null, footer:'_💡 dica_',
  });
  assert.match(card, /^💸 \*Gasto registrado!\*/);
  assert.ok(card.split(SEP).length === 3, 'deve ter 2 separadores');
  assert.match(card, /🧾 \*iFood\*/);
  assert.match(card, /💰 \*R\$ 45,00\*/);
  assert.match(card, /🗂️ Categoria: Alimentação/);
  assert.match(card, /💜 Carteira: \*Nubank\*/);
  assert.match(card, /💼 Saldo Nubank: \*−R\$ 45,00\*/);
  assert.match(card, /_💡 dica_$/);
});
test('gasto sem carteira: omite carteira/saldo e o 2º separador', () => {
  const card = buildTxnConfirmation({
    type:'expense', description:'Mercado', amount:80, categoryLabel:'Alimentação',
    account:null, newBalance:null, budgetBlock:null, footer:'_x_',
  });
  assert.doesNotMatch(card, /Carteira:/);
  assert.doesNotMatch(card, /Saldo/);
  assert.strictEqual(card.split(SEP).length, 2, 'só 1 separador quando não há cauda');
});
test('receita: header de receita e saldo positivo com +', () => {
  const card = buildTxnConfirmation({
    type:'income', description:'Salário', amount:5000, categoryLabel:'Salário',
    account:{name:'Itaú', icon:'🧡'}, newBalance:9875, budgetBlock:null, footer:'_x_',
  });
  assert.match(card, /^💰 \*Receita registrada!\*/);
  assert.match(card, /💼 Saldo Itaú: \*\+R\$ 9\.875,00\*/);
});
test('sem descrição usa o label da categoria no título', () => {
  const card = buildTxnConfirmation({
    type:'expense', description:null, amount:30, categoryLabel:'Outros',
    account:null, newBalance:null, budgetBlock:null, footer:'_x_',
  });
  assert.match(card, /🧾 \*Outros\*/);
});
test('bloco de orçamento entra na cauda, antes do footer', () => {
  const card = buildTxnConfirmation({
    type:'expense', description:'Mercado', amount:80, categoryLabel:'Alimentação',
    account:null, newBalance:null,
    budgetBlock:'📊 Alimentação: R$ 125,00 / R$ 100,00 (125%)', footer:'_💡 fim_',
  });
  assert.ok(card.indexOf('📊 Alimentação') < card.indexOf('_💡 fim_'));
  assert.strictEqual(card.split(SEP).length, 3, 'orçamento cria a 2ª seção');
});

// ---- buildSourceQuestion + footer de receita ----
test('pergunta de fonte (despesa): verbo "saiu", lista carteiras+cartões+Dinheiro', () => {
  const q = buildSourceQuestion({ type: 'expense', amount: 30, accounts: [{ name: 'Itaú', icon: '🧡' }], cards: [{ name: 'Nubank' }] });
  assert.match(q, /saiu de qual conta/i);
  assert.match(q, /1️⃣ 🧡 Itaú/);
  assert.match(q, /Nubank \(cartão\)/);
  assert.match(q, /💵 Dinheiro/);
});
test('pergunta de fonte (receita): verbo "caiu" e SEM cartão na lista', () => {
  const q = buildSourceQuestion({ type: 'income', amount: 5000, accounts: [{ name: 'Itaú', icon: '🧡' }], cards: [{ name: 'Nubank' }] });
  assert.match(q, /caiu em qual conta/i);
  assert.doesNotMatch(q, /cartão/i);
});
test('não duplica Dinheiro se já existe carteira Dinheiro', () => {
  const q = buildSourceQuestion({ type: 'expense', amount: 10, accounts: [{ name: 'Dinheiro', icon: '💵' }], cards: [] });
  assert.strictEqual((q.match(/Dinheiro/g) || []).length, 1);
});
test('footer educativo de receita não diz "de onde saiu"', () => {
  const f = buildTxnFooter({ categoryMissing: false, accountLinked: false, tipSeed: 0, type: 'income' });
  assert.doesNotMatch(f, /de onde saiu/i);
  assert.match(f, /caiu/i);
});
