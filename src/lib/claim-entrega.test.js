// src/lib/claim-entrega.test.js
// Trava o gate de VERBO DE ENTREGA do relatório de governança.
const { test } = require('node:test');
const assert = require('node:assert');
const { rebaixarClaimDeEntrega, temClaimDeEntrega } = require('./claim-entrega');

// O incidente que originou este gate: relatório do agente de governança em 10/08 afirmou que
// o Rafinha RECEBEU o recado. No banco, `read_at` e `recipient_message_id` estavam nulos —
// havia registro de ENVIO, nenhum de entrega. Auditoria cruzada pegou; o código não pegava.
test('rebaixa "recebeu" para "enviado" — o caso Rafinha de 10/08', () => {
  const r = rebaixarClaimDeEntrega('Confirmei que o Rafinha recebeu o recado sobre a lâmpada.');
  assert.match(r.texto, /foi enviado/i);
  assert.doesNotMatch(r.texto, /recebeu/i);
  assert.strictEqual(r.rebaixou, true);
});

test('pega leu / visualizou / foi entregue', () => {
  for (const frase of [
    'A Kailane leu a mensagem.',
    'A Bianca visualizou o aviso.',
    'O recado foi entregue à Rose.',
  ]) {
    assert.strictEqual(temClaimDeEntrega(frase), true, `devia pegar: ${frase}`);
  }
});

// O gate NÃO pode virar o `enviad*` que disparou dentro de FATURA. O verbo sozinho não basta:
// "recebeu" fora do eixo de mensagem é assunto de outra pessoa, e reescrever aí seria
// corromper o relatório em vez de torná-lo honesto.
test('NÃO dispara fora do eixo de mensagem', () => {
  for (const frase of [
    'O webhook recebeu 43 eventos da UAZAPI.',
    'A conta recebeu o crédito de R$ 200.',
    'O script leu 300 linhas do log.',
    'A tarefa foi entregue no prazo pela Ana.',
  ]) {
    assert.strictEqual(temClaimDeEntrega(frase), false, `NÃO devia pegar: ${frase}`);
  }
});

// Quem já fala a verdade não pode ser reescrito — senão o gate ensina o agente a evitar a
// palavra certa, e a gente perde informação em vez de ganhar.
test('texto que já diz "enviado" passa intacto', () => {
  const t = 'O recado foi enviado à Rose às 14h (entrega não confirmada).';
  const r = rebaixarClaimDeEntrega(t);
  assert.strictEqual(r.texto, t);
  assert.strictEqual(r.rebaixou, false);
});

test('anexa a nota UMA vez, mesmo com vários claims', () => {
  const r = rebaixarClaimDeEntrega('O Rafinha recebeu o recado. A Rose leu a mensagem.');
  assert.strictEqual((r.texto.match(/só o registro de envio/gi) || []).length, 1);
  assert.ok(r.termos.length >= 2);
});

test('entrada vazia/inválida não quebra', () => {
  for (const v of [null, undefined, '', 42]) {
    const r = rebaixarClaimDeEntrega(v);
    assert.strictEqual(r.rebaixou, false);
  }
});
