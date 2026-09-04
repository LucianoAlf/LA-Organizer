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

test('linha de grupo: nome, fichas, pool, memória da noite e o alerta só quando existe', () => {
  assert.strictEqual(formatarLinhaGrupo({ nome: 'Administração Recreio', fichas: 0, abertas: 5, claims: 0, memorias: 5 }),
    'Administração Recreio: 0 fichas · 5 abertas · +5 memórias');
  assert.strictEqual(formatarLinhaGrupo({ nome: 'Financeiro', fichas: 3, abertas: 0, claims: 2, memorias: 0 }),
    'Financeiro: 3 fichas · 0 abertas · +0 memórias · ⚠️ 2 disse-sem-gravar');
});

test('resumo: warning só quando ALGUM grupo teve claim sem escrita', () => {
  const limpo = resumirGrupos([{ nome: 'A', fichas: 1, abertas: 2, claims: 0, memorias: 3 }]);
  assert.strictEqual(limpo.status, 'ok');
  const sujo = resumirGrupos([{ nome: 'A', fichas: 1, abertas: 2, claims: 0, memorias: 3 },
                              { nome: 'B', fichas: 0, abertas: 0, claims: 1, memorias: 0 }]);
  assert.strictEqual(sujo.status, 'warning');
  assert.match(sujo.detail, /B: 0 fichas · 0 abertas · \+0 memórias · ⚠️ 1 disse-sem-gravar/);
});

test('sem grupo ativo não vira alarme', () => {
  assert.strictEqual(resumirGrupos([]).status, 'ok');
});

// ── LIÇÕES ESPERANDO APROVAÇÃO ────────────────────────────────────────────────────────────
// O gate só serve se o Alf souber que tem algo represado. Sem esta linha, lição fica parada
// no banco pra sempre e o TOM nunca aprende — o freio vira paralisia.
const { resumirLicoesPendentes } = require('./health-check');

test('nenhuma lição pendente não vira alarme', () => {
  assert.strictEqual(resumirLicoesPendentes([]).status, 'ok');
});

test('lição pendente aparece com o grupo e o dia, pra decidir sem abrir nada', () => {
  const r = resumirLicoesPendentes([
    { grupo: 'Administração Recreio', dia: '2026-09-02', conteudo: 'Quando um contrato for assinado, alguém do grupo informa pro TOM dar baixa' },
  ]);
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /1 lição/);
  assert.match(r.detail, /Administração Recreio/);
  assert.match(r.detail, /02\/09/);
  assert.match(r.detail, /Quando um contrato for assinado/);
});

test('muitas lições: mostra as 3 primeiras e diz quantas sobraram', () => {
  const muitas = Array.from({ length: 5 }, (_, i) => ({ grupo: 'G', dia: '2026-09-02', conteudo: `licao numero ${i}` }));
  const r = resumirLicoesPendentes(muitas);
  assert.match(r.detail, /5 lições/);
  assert.match(r.detail, /\+2/);
});

// A fila deixou de ser só de lições: `fact` e `preference` também esperam o ok. Se o aviso das
// 05:00 continuasse contando só `lesson`, o Alf nunca ficaria sabendo do que está represado —
// gate com fila e SEM aviso é a mesma cegueira, um andar acima.
test('memória de outro tipo esperando aprovação também aparece no aviso', () => {
  const r = resumirLicoesPendentes([
    { grupo: 'Barra', dia: '2026-09-04', conteudo: 'o Arthur cuida da matricula', tipo: 'fact' },
    { grupo: 'ADM CG', dia: '2026-09-04', conteudo: 'chame pelo nome', tipo: 'lesson' },
  ]);
  assert.strictEqual(r.status, 'warning');
  assert.match(r.detail, /2 memórias/, 'com tipo misturado a palavra não pode ser "lições"');
  assert.match(r.detail, /o Arthur cuida da matricula/);
});

// Quando tudo que espera é lição, a palavra continua sendo "lição" — o aviso não fica mais vago
// do que era.
test('só lições esperando: o aviso continua falando de lição', () => {
  const r = resumirLicoesPendentes([
    { grupo: 'ADM CG', dia: '2026-09-04', conteudo: 'chame pelo nome', tipo: 'lesson' },
  ]);
  assert.match(r.detail, /1 lição/);
});
