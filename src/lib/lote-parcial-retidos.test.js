'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tiraLinhasDosRetidos } = require('./lote-parcial-retidos');

// A2-PERGUNTA-SOME-NO-LOTE-PARCIAL — turno real da Juliana, 09/09 19:48 BRT.
// Ela respondeu "1. Feito 2. Feito 3. Pedi pra adiar…". A trava A2 segurou as duas primeiras
// pra confirmar; o reagendamento da 3ª entrou. A fala do LLM (abaixo) já dizia "Feitos".
const LLM_JULIANA = '*Feitos:*\n• Reunião com o Léo e a Kryssia\n• Conversar com o Peterson\n\n📅 *Reagendado:*\n'
  + '• Jornada do curso de teatro → *30/09* (confirmei pro final de setembro — me avisa se a data mudar)';
const RETIDAS_JULIANA = [
  'Reunião com o Léo e a Kryssia pra falar sobre os estagiários',
  'Conversar com o Peterson sobre o processo do estágio',
];

test('Juliana: some a seção que afirmava as 2 seguradas e fica o reagendamento que entrou', () => {
  assert.strictEqual(tiraLinhasDosRetidos(LLM_JULIANA, RETIDAS_JULIANA),
    '📅 *Reagendado:*\n• Jornada do curso de teatro → *30/09* (confirmei pro final de setembro — me avisa se a data mudar)');
});

test('sem tarefa segurada, o texto sai intacto', () => {
  assert.strictEqual(tiraLinhasDosRetidos(LLM_JULIANA, []), LLM_JULIANA);
  assert.strictEqual(tiraLinhasDosRetidos(LLM_JULIANA, undefined), LLM_JULIANA);
});

test('uma palavra em comum não derruba linha de outro assunto', () => {
  const t = '✅ Feita a *Reunião de pais*.';
  assert.strictEqual(tiraLinhasDosRetidos(t, RETIDAS_JULIANA), t);
});

test('cabeçalho que ainda tem item embaixo fica', () => {
  const t = '*Feitos:*\n• Reunião com o Léo e a Kryssia\n• Postar o feed da semana';
  assert.strictEqual(tiraLinhasDosRetidos(t, RETIDAS_JULIANA), '*Feitos:*\n• Postar o feed da semana');
});

test('tudo segurado → fala vazia (o caller põe só a pergunta)', () => {
  const t = '*Feitos:*\n• Reunião com o Léo e a Kryssia\n• Conversar com o Peterson';
  assert.strictEqual(tiraLinhasDosRetidos(t, RETIDAS_JULIANA), '');
});

test('entrada torta nunca quebra', () => {
  assert.strictEqual(tiraLinhasDosRetidos(null, RETIDAS_JULIANA), '');
  assert.strictEqual(tiraLinhasDosRetidos('', RETIDAS_JULIANA), '');
});
