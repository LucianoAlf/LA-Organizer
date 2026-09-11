'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { falaDoQueTentou } = require('./falha-diz-alvo');

// Leo 08/07 10:24 (c8dbae5b): "Pode cancelar todos os pedidos para falar com qualquer pessoa" — o LLM
// mandou cancelar duas "pendências de retorno" que não existiam. A resposta empurrava a repetir.
const LEO = [{ action: 'cancel', title: 'Retorno Quintela' }, { action: 'cancel', title: 'Retorno Juliana' }];

test('Leo: cancelar o que não está aberto diz que não há nada pendente — não manda repetir', () => {
  const f = falaDoQueTentou(LEO);
  assert.strictEqual(f, '_Não achei aberta na sua lista: *Retorno Quintela*, *Retorno Juliana* — então não tem nada pendente com esse nome pra cancelar. Se era outra, me diz o nome._');
  assert.doesNotMatch(f, /Confere o nome/);
});

test('as outras ações continuam pedindo o nome certo (lá, não achar não significa "já está feito")', () => {
  assert.match(falaDoQueTentou([{ action: 'complete', title: 'Relatório' }]), /Confere o nome/);
  assert.match(falaDoQueTentou([{ action: 'reschedule', title: 'Reunião' }]), /pra remarcar/);
});
