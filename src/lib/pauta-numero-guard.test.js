'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { corrigirNumerosDaPauta } = require('./pauta-numero-guard');
const { blocoDaPautaDM } = require('../services/pauta-dm');

const arr = (n) => Array.from({ length: n }, (_, i) => ({ i }));
const BARRA = { unidadeNome: 'Barra', anamnese: arr(19), contrato: arr(28) };
const CG = { unidadeNome: 'Campo Grande', anamnese: arr(27), contrato: arr(16) };

test('caso real Kailane 03/10: "26 … na Barra" com 19 na fonte → 19', () => {
  const t = '📭 Nada marcado na sua agenda.\n📋 26 anamneses pendentes hoje na Barra · 28 contratos sem assinatura';
  const r = corrigirNumerosDaPauta(t, [BARRA]);
  assert.match(r.texto, /📋 19 anamneses pendentes hoje na Barra · 28 contratos/);
  assert.deepStrictEqual(r.trocas, [{ unidade: 'Barra', campo: 'anamnese', de: 26, para: 19 }]);
});
test('número certo fica intacto (Arthur 03/10)', () => {
  const t = '📋 19 anamneses pendentes hoje na Barra · 28 contratos sem assinatura';
  assert.deepStrictEqual(corrigirNumerosDaPauta(t, [BARRA]), { texto: t, trocas: [] });
});
test('linha sem unidade só é conferida com UMA unidade', () => {
  assert.match(corrigirNumerosDaPauta('📋 13 alunos ainda sem anamnese hoje · 2 sem contrato assinado', [BARRA]).texto, /19 alunos ainda sem anamnese hoje · 28 sem contrato/);
  const duas = '📋 13 anamneses pendentes hoje';
  assert.strictEqual(corrigirNumerosDaPauta(duas, [BARRA, CG]).texto, duas);
});
test('cada linha usa a sua unidade; total e fonte que falhou ficam de fora', () => {
  const t = '📋 5 anamneses hoje no Campo Grande\n📋 5 anamneses hoje na Barra\n(total: 99 anamneses no Campo Grande)';
  const r = corrigirNumerosDaPauta(t, [CG, BARRA]);
  assert.strictEqual(r.texto, '📋 27 anamneses hoje no Campo Grande\n📋 19 anamneses hoje na Barra\n(total: 99 anamneses no Campo Grande)');
  const falha = corrigirNumerosDaPauta('📋 5 anamneses hoje na Barra', [{ unidadeNome: 'Barra', anamnese: null, motivo: 'caiu' }]);
  assert.deepStrictEqual(falha.trocas, []);
});
test('outros números do bom dia (PIX, tarefas) não são tocados', () => {
  const t = '⚠️ 10 PIX automático parados na Barra\n1. 🔴 *Ligar para a Gisele* — atrasada 3 dias';
  assert.strictEqual(corrigirNumerosDaPauta(t, [BARRA]).texto, t);
});
test('o exemplo da regra do bom dia não traz número (o modelo copiava o 26)', () => {
  const b = blocoDaPautaDM({ porUnidade: [], hoje: '2026-10-03', ritual: true });
  const regra = b.split('\n').find((l) => l.startsWith('- No bom dia'));
  assert.ok(regra && !/\d/.test(regra), regra);
});
