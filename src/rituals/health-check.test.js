// src/rituals/health-check.test.js — partes PURAS do laudo diario.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// ── PAINEL DE GRUPOS no laudo diário (pedido do Alf, 02/09) ───────────────────────────────
// Ele saiu do dia a dia dos grupos de propósito ("é um grupo particular deles") mas quer
// enxergar o que acontece lá. A linha por grupo é o instrumento: ficha é a ferramenta que o
// time pediu sem saber que existia, pool é o trabalho vivo, e "disse sem gravar" é o sintoma
// que a gente passou o dia caçando.
const { formatarLinhaGrupo, resumirGrupos } = require('./health-check');

test('linha de grupo: nome, fichas, pool e o alerta só quando existe', () => {
  assert.strictEqual(formatarLinhaGrupo({ nome: 'Administração Recreio', fichas: 0, abertas: 5, claims: 0 }),
    'Administração Recreio: 0 fichas · 5 abertas');
  assert.strictEqual(formatarLinhaGrupo({ nome: 'Financeiro', fichas: 3, abertas: 0, claims: 2 }),
    'Financeiro: 3 fichas · 0 abertas · ⚠️ 2 disse-sem-gravar');
});

test('resumo: warning só quando ALGUM grupo teve claim sem escrita', () => {
  const limpo = resumirGrupos([{ nome: 'A', fichas: 1, abertas: 2, claims: 0 }]);
  assert.strictEqual(limpo.status, 'ok');
  const sujo = resumirGrupos([{ nome: 'A', fichas: 1, abertas: 2, claims: 0 },
                              { nome: 'B', fichas: 0, abertas: 0, claims: 1 }]);
  assert.strictEqual(sujo.status, 'warning');
  assert.match(sujo.detail, /B: 0 fichas · 0 abertas · ⚠️ 1 disse-sem-gravar/);
});

test('sem grupo ativo não vira alarme', () => {
  assert.strictEqual(resumirGrupos([]).status, 'ok');
});
