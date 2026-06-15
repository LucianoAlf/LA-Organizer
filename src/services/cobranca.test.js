// src/services/cobranca.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildCobrancaMessage, ddmm, firstName, daysOverdue } = require('./cobranca');

test('ddmm: YYYY-MM-DD → DD/MM; vazio → ""', () => {
  assert.equal(ddmm('2026-06-13'), '13/06');
  assert.equal(ddmm(null), '');
  assert.equal(ddmm(''), '');
});

test('firstName: primeiro nome; vazio → ""', () => {
  assert.equal(firstName('Rafael Souza'), 'Rafael');
  assert.equal(firstName('  '), '');
  assert.equal(firstName(null), '');
});

test('daysOverdue: passado → dias positivos; hoje/futuro/sem prazo → null', () => {
  assert.equal(daysOverdue('2026-06-13', '2026-06-15'), 2);
  assert.equal(daysOverdue('2026-06-15', '2026-06-15'), null); // mesmo dia não é atraso
  assert.equal(daysOverdue('2026-06-20', '2026-06-15'), null); // futuro
  assert.equal(daysOverdue(null, '2026-06-15'), null);
});

test('cobrança atrasada: saúda pelo 1º nome, título em negrito, venceu DD/MM + dias, pede retorno', () => {
  const msg = buildCobrancaMessage({
    assigneeName: 'Rafinha',
    taskTitle: 'Comprar 3 placas de drywall — Sala 5 Canto',
    dueYmd: '2026-06-13',
    todayYmd: '2026-06-15',
    requesterName: 'Luciano Alf',
  });
  assert.match(msg, /Oi, Rafinha!/);
  assert.match(msg, /\*Comprar 3 placas de drywall — Sala 5 Canto\*/);
  assert.match(msg, /venceu 13\/06 \(2 dias atrás\)/);
  assert.match(msg, /Consegue tocar hoje\?/);
  assert.match(msg, /O Luciano pediu um retorno\./);
  assert.match(msg, /retorno aqui/);
});

test('1 dia de atraso → singular "1 dia atrás"', () => {
  const msg = buildCobrancaMessage({ assigneeName: 'Ana', taskTitle: 'X', dueYmd: '2026-06-14', todayYmd: '2026-06-15' });
  assert.match(msg, /venceu 14\/06 \(1 dia atrás\)/);
});

test('sem requester → não cita ninguém; sem nome → "Oi!"', () => {
  const msg = buildCobrancaMessage({ assigneeName: '', taskTitle: 'Tarefa Y', dueYmd: '2026-06-13', todayYmd: '2026-06-15' });
  assert.match(msg, /^👋 Oi! Passando/);
  assert.ok(!msg.includes('pediu um retorno'), 'não deve citar requester ausente');
});

test('tarefa sem prazo → não inventa data, ainda pede retorno', () => {
  const msg = buildCobrancaMessage({ assigneeName: 'João', taskTitle: 'Z', dueYmd: null, todayYmd: '2026-06-15' });
  assert.ok(!msg.includes('venceu'), 'sem prazo não fala venceu');
  assert.ok(!msg.includes('📅'), 'sem prazo não mostra linha de data');
  assert.match(msg, /Consegue tocar\?/); // sem "hoje" quando não está atrasada
  assert.match(msg, /\*Z\*/);
});
