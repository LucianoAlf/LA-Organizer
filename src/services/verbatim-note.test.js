'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeForMatch, containmentRatio, pickVerbatimSource, stripSaveCommand } = require('./verbatim-note');

const DIGEST = [
  '👽 Luciano, fechamento do dia 👇',
  '✅ 29 movimentos bateram com o que você lançou.',
  '• R$ 1.000,00 → JEREMIAS ANTONIO DE PAULA JUNIOR (23/06)',
  '• R$ 4.143,24 → BANCO SANTANDER BRASIL S A (22/06)',
  '…e mais 468 dos últimos meses (revisa no app quando puder).',
  'Maior alavanca: você fechou o mês no vermelho — segura as despesas.',
  'Saldo real das contas hoje: R$ 1.966,56',
].join('\n');

// LLM "copiou" o digest mas CORTOU 2 linhas (468 + Maior alavanca) — o bug real.
const LLM_BODY_TRUNCATED = [
  'Fechamento do dia',
  '29 movimentos bateram',
  'R$ 1.000,00 JEREMIAS ANTONIO DE PAULA JUNIOR 23/06',
  'R$ 4.143,24 BANCO SANTANDER BRASIL 22/06',
  'Saldo real R$ 1.966,56',
].join('\n');

test('normalizeForMatch tira acento/emoji/pontuação', () => {
  assert.equal(normalizeForMatch('Saúde 18/100 🔴 → R$'), 'saude 18 100 r');
});

test('containmentRatio: body truncado é quase todo contido na fonte', () => {
  const r = containmentRatio(LLM_BODY_TRUNCATED, DIGEST);
  assert.ok(r >= 0.6, `esperava ≥0.6, veio ${r.toFixed(2)}`);
});

test('containmentRatio: texto não-relacionado é baixo', () => {
  const r = containmentRatio(LLM_BODY_TRUNCATED, 'lista de compras: leite, pão, café e ovos');
  assert.ok(r < 0.4, `esperava <0.4, veio ${r.toFixed(2)}`);
});

test('pickVerbatimSource: acha a mensagem-fonte (digest) entre candidatos', () => {
  const candidates = ['oi tudo bem?', 'lista de compras leite pao', DIGEST, 'beleza valeu'];
  const src = pickVerbatimSource(LLM_BODY_TRUNCATED, candidates);
  assert.ok(src, 'devia achar fonte');
  assert.equal(src.index, 2);
  assert.equal(src.text, DIGEST);
});

test('pickVerbatimSource: sem fonte boa → null (fallback pro LLM body)', () => {
  const src = pickVerbatimSource(LLM_BODY_TRUNCATED, ['oi', 'tudo bem', 'curto']);
  assert.equal(src, null);
});

test('pickVerbatimSource: ignora candidatos curtos demais (ruído)', () => {
  const src = pickVerbatimSource('R$ 1.000', ['R$ 1.000']); // < minLen 40
  assert.equal(src, null);
});

test('stripSaveCommand: comando como linha separada no topo é removido, conteúdo intacto', () => {
  const t = 'Tom, salva isso nas minhas anotações com o nome Fechamento:\n' + DIGEST;
  const out = stripSaveCommand(t);
  assert.ok(out.startsWith('👽 Luciano, fechamento'), out.slice(0, 40));
  assert.ok(out.includes('468'), 'manteve a linha do 468');
  assert.ok(out.includes('Maior alavanca'), 'manteve a Maior alavanca');
});

test('stripSaveCommand: comando + conteúdo na MESMA linha (prefixo até ":") corta só o prefixo', () => {
  const out = stripSaveCommand('salva isso: Fechamento do dia 26/06\n• R$ 10,00 item');
  assert.ok(out.startsWith('Fechamento do dia 26/06'), out.slice(0, 40));
  assert.ok(out.includes('R$ 10,00 item'));
});

test('stripSaveCommand: comando no FIM é removido', () => {
  const out = stripSaveCommand(DIGEST + '\nsalva isso por favor');
  assert.ok(out.endsWith('R$ 1.966,56'), out.slice(-30));
});

test('stripSaveCommand: fonte sem comando (msg do TOM) fica intacta', () => {
  const out = stripSaveCommand(DIGEST);
  assert.equal(out, DIGEST);
});

test('stripSaveCommand: NUNCA remove linha de conteúdo que contém número/valor mesmo citando palavra', () => {
  // linha de conteúdo com valor não pode sumir
  const t = '• R$ 375,00 ← RAFAEL MOTTA (anota: repasse)';
  const out = stripSaveCommand(t);
  assert.ok(out.includes('375,00'), 'linha com valor preservada');
});
