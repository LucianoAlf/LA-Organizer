'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { merchantKey, resolveItemCategory, groupUnknowns, detectCategoryCorrections } = require('./categorize-invoice');

// slugs válidos de teste (subset dos 30 reais)
const SLUGS = new Set(['transporte', 'mercado', 'compras', 'farmacia', 'outros', 'combustivel', 'estacionamento', 'alimentacao']);

// === merchantKey (o linchpin) ===

test('merchantKey: os 10 MP*CONECTCAR viram UMA chave', () => {
  const ks = ['MP*CONECTCAR', 'MP*CONECTCAR', 'mp*conectcar ', 'MP*CONECTCAR (1/1)'].map(merchantKey);
  assert.strictEqual(new Set(ks).size, 1, 'todos os ConectCar colapsam numa chave só');
});

test('merchantKey: cidade/UF colada não separa (SmartShelvePETROPOLISBR == SmartShelve)', () => {
  assert.strictEqual(merchantKey('SmartShelvePETROPOLISBR'), merchantKey('SmartShelve'));
});

test('merchantKey: sufixo de parcela sai (AMAZON MARKETP 02/03 == AMAZON MARKETP)', () => {
  assert.strictEqual(merchantKey('AMAZON MARKETP 02/03'), merchantKey('AMAZON MARKETP'));
});

test('merchantKey: parcela entre parênteses sai (SHOPEE (1/2) == SHOPEE)', () => {
  assert.strictEqual(merchantKey('SHOPEE *TRIBOS (1/2)'), merchantKey('SHOPEE *TRIBOS'));
});

test('merchantKey: dígitos de loja colapsam (PREZUNIC 716 == Prezunic)', () => {
  assert.strictEqual(merchantKey('PREZUNIC 716RIO DE JANE'), merchantKey('Prezunic'));
});

test('merchantKey: não devolve vazio pra nome curto', () => {
  assert.ok(merchantKey('Rei do Mate').length >= 3);
});

// === resolveItemCategory (a precedência) ===

test('learned VENCE tudo (mesmo com gemini e rules diferentes)', () => {
  const learned = new Map([[merchantKey('MP*CONECTCAR'), 'transporte']]);
  const r = resolveItemCategory({ descricao: 'MP*CONECTCAR', tipo: 'expense', geminiHint: 'compras', learned, validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'transporte');
  assert.strictEqual(r.source, 'learned');
});

test('rules VENCE gemini (Prezunic → mercado pela regra, não pelo palpite compras)', () => {
  const r = resolveItemCategory({ descricao: 'PREZUNIC 716', tipo: 'expense', geminiHint: 'compras', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'mercado');
  assert.strictEqual(r.source, 'rules');
});

test('gemini preenche onde ninguém sabe', () => {
  const r = resolveItemCategory({ descricao: 'LOJA XYZ DESCONHECIDA', tipo: 'expense', geminiHint: 'compras', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'compras');
  assert.strictEqual(r.source, 'gemini');
});

test('slug INVÁLIDO do LLM é descartado → outros', () => {
  const r = resolveItemCategory({ descricao: 'LOJA XYZ', tipo: 'expense', geminiHint: 'pedágio', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'outros');
  assert.strictEqual(r.source, 'fallback');
});

test('gemini não pode devolver "outros" e fingir que sabe', () => {
  const r = resolveItemCategory({ descricao: 'LOJA XYZ', tipo: 'expense', geminiHint: 'outros', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.source, 'fallback');
});

test('income NUNCA casa merchant nem gemini', () => {
  const r = resolveItemCategory({ descricao: 'PIX RECEBIDO', tipo: 'income', geminiHint: 'compras', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'outros');
});

test('gemini ausente (null) → cai em rules/outros (comportamento de hoje)', () => {
  const r = resolveItemCategory({ descricao: 'LOJA XYZ', tipo: 'expense', geminiHint: null, learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'outros');
});

test('merchant real da Rose: ConectCar → transporte por REGRA (sem gemini, sem learned)', () => {
  const r = resolveItemCategory({ descricao: 'MP*CONECTCAR', tipo: 'expense', geminiHint: null, learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'transporte');
  assert.strictEqual(r.source, 'rules');
});

// === groupUnknowns (a TRAVA de ordenação) ===

test('TRAVA: ConectCar (10×, R$135) vem ANTES de LUCASDONAS (1×, R$500)', () => {
  const itens = [
    { descricao: 'MP *LUCASDONAS', valor: 500, categoria: 'outros', _catSource: 'fallback' },
    ...Array.from({ length: 10 }, () => ({ descricao: 'MP*CONECTCAR', valor: 13.5, categoria: 'outros', _catSource: 'fallback' })),
  ];
  const g = groupUnknowns(itens);
  assert.strictEqual(g[0].merchantKey, merchantKey('MP*CONECTCAR'), 'repetição vence valor');
  assert.strictEqual(g[0].count, 10);
});

test('groupUnknowns: só agrupa fallback/gemini, ignora learned/rules', () => {
  const itens = [
    { descricao: 'AAA', valor: 10, _catSource: 'rules' },
    { descricao: 'BBB', valor: 10, _catSource: 'learned' },
    { descricao: 'CCC', valor: 10, _catSource: 'fallback' },
  ];
  const g = groupUnknowns(itens);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].merchantKey, merchantKey('CCC'));
});

test('groupUnknowns: teto de 3 (o resto vai sem perguntar)', () => {
  const itens = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((d) => ({ descricao: d, valor: 10, _catSource: 'fallback' }));
  assert.strictEqual(groupUnknowns(itens).length, 3);
});

test('groupUnknowns: zero desconhecido → array vazio (sem "me confirma 0 coisas")', () => {
  const itens = [{ descricao: 'AAA', valor: 10, _catSource: 'rules' }];
  assert.deepStrictEqual(groupUnknowns(itens), []);
});

test('groupUnknowns: empate de count desempata por valor (maior primeiro)', () => {
  const itens = [
    { descricao: 'AAA', valor: 10, _catSource: 'fallback' },
    { descricao: 'BBB', valor: 90, _catSource: 'fallback' },
  ];
  const g = groupUnknowns(itens);
  assert.strictEqual(g[0].merchantKey, merchantKey('BBB'));
});

// === detectCategoryCorrections (o parser da correção → aprende) ===

const UNK = [
  { merchantKey: merchantKey('MP*CONECTCAR'), label: 'ConectCar' },
  { merchantKey: merchantKey('Abastec'), label: 'Abastec' },
  { merchantKey: merchantKey('MP *LUCASDONAS'), label: 'LUCASDONAS' },
];
const ITENS_FAT = [
  { descricao: 'MP*CONECTCAR' }, { descricao: 'Abastec' }, { descricao: 'MP *LUCASDONAS' },
];

test('correção "1 é pedágio" → ConectCar vira transporte (sinônimo PT)', () => {
  const r = detectCategoryCorrections('1 é pedágio', UNK, ITENS_FAT, SLUGS);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].merchantKey, merchantKey('MP*CONECTCAR'));
  assert.strictEqual(r[0].slug, 'transporte');
});

test('correção "o 2 é combustível" (slug canônico) → Abastec', () => {
  const r = detectCategoryCorrections('o 2 é combustível', UNK, ITENS_FAT, SLUGS);
  assert.strictEqual(r[0].merchantKey, merchantKey('Abastec'));
  assert.strictEqual(r[0].slug, 'combustivel');
});

test('correção múltipla "1 é pedágio, 3 é compras"', () => {
  const r = detectCategoryCorrections('1 é pedágio, 3 é compras', UNK, ITENS_FAT, SLUGS);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r.find((x) => x.slug === 'transporte').merchantKey, merchantKey('MP*CONECTCAR'));
  assert.strictEqual(r.find((x) => x.slug === 'compras').merchantKey, merchantKey('MP *LUCASDONAS'));
});

test('correção por NOME "ConectCar é transporte"', () => {
  const r = detectCategoryCorrections('ConectCar é transporte', UNK, ITENS_FAT, SLUGS);
  assert.strictEqual(r[0].merchantKey, merchantKey('MP*CONECTCAR'));
  assert.strictEqual(r[0].slug, 'transporte');
});

test('"sim" (aceite do lote) → NÃO é correção, retorna []', () => {
  assert.deepStrictEqual(detectCategoryCorrections('sim', UNK, ITENS_FAT, SLUGS), []);
});

test('"lançar" → NÃO é correção, retorna []', () => {
  assert.deepStrictEqual(detectCategoryCorrections('lançar', UNK, ITENS_FAT, SLUGS), []);
});

test('índice fora do range → ignorado (não inventa)', () => {
  assert.deepStrictEqual(detectCategoryCorrections('9 é transporte', UNK, ITENS_FAT, SLUGS), []);
});

test('categoria inexistente ("1 é jaba") → ignorado', () => {
  assert.deepStrictEqual(detectCategoryCorrections('1 é jaba', UNK, ITENS_FAT, SLUGS), []);
});
