const { test } = require('node:test');
const assert = require('node:assert');
const { salaConfirmada } = require('./inventory-sala-guard');

const SESSAO_13 = { sala_id: 36, sala_nome: 'Sala 13 Cordas' };

test('sessão travada + marker sem sala → confirmada (fluxo batch)', () => {
  assert.strictEqual(salaConfirmada({ persisted: SESSAO_13, inboundText: 'guitarra tagima' }), true);
});

test('sessão travada + marker com a MESMA sala → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13 Cordas', persisted: SESSAO_13, inboundText: '' }), true);
});

test('sessão travada + marker sala DIFERENTE dita no turno → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 14', persisted: SESSAO_13, inboundText: 'agora a Sala 14' }), true);
});

test('sem sessão + user disse a sala no texto → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: 'Sala 13 - Campo Grande' }), true);
});

test('sem sessão + nome cheio no marker mas número bate no texto → confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13 Cordas', persisted: null, inboundText: 'campo grande, sala 13' }), true);
});

test('caption da foto com a sala conta (vem no inboundText) → confirmada', () => {
  const t = '[O usuário ACABOU DE ENVIAR uma imagem agora — Análise: guitarra]\nLegenda enviada pelo usuário: "Guitarra X — Sala 13"';
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: t }), true);
});

test('BUG-ALVO: sem sessão + texto sem sala + marker herdou sala do histórico → NÃO confirmada', () => {
  const t = '[O usuário ACABOU DE ENVIAR uma imagem agora — Análise: guitarra vermelha]';
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: t }), false);
});

test('normalização: acento/caixa não atrapalham', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Salão Nobre', persisted: null, inboundText: 'cadastra no salao nobre' }), true);
});

test('nada confirmado (sem sessão, sem texto) → NÃO confirmada', () => {
  assert.strictEqual(salaConfirmada({ markerSalaNome: 'Sala 13', persisted: null, inboundText: '' }), false);
});
