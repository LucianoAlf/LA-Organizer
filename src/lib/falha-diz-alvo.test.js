// src/lib/falha-diz-alvo.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { falaDoQueTentou, GENERICO } = require('./falha-diz-alvo');

// TASK-COMPLETE-ALVO-NAO-ACHADO reincidiu 2×. O fix de 13/08 deu fala honesta ao handler
// `complete` — 1 dos 101 `failCount++` do engine. Os outros 100 seguem mudos e caem no
// genérico "não consegui registrar agora. Me passa de novo?", que não diz O QUE falhou.
// A pessoa reenvia a mesma coisa e leva a mesma resposta: beco.
//
// Este é o chokepoint na SAÍDA — onde os 101 convergem —, não mais um guard por handler.
// Guards por caminho viram queijo suíço; foi o antipadrão 13.1 do manual de governança.
test('nomeia o que tentou concluir', () => {
  const t = falaDoQueTentou([{ action: 'complete', title: 'Dress code' }, { action: 'complete', title: 'Emusys' }]);
  assert.match(t, /Dress code/);
  assert.match(t, /Emusys/);
  assert.doesNotMatch(t, /Me passa de novo/); // o genérico é justamente o que se troca
});

// A fala tem de mudar conforme o VERBO: "não achei pra concluir" é diferente de "não achei
// pra remarcar". Dizer "registrar" para tudo é o genérico com outro nome.
test('distingue a ação pedida', () => {
  assert.match(falaDoQueTentou([{ action: 'complete', title: 'X' }]), /conclui|fechar/i);
  assert.match(falaDoQueTentou([{ action: 'reschedule', title: 'X' }]), /remarc|adia/i);
  assert.match(falaDoQueTentou([{ action: 'cancel', title: 'X' }]), /cancel/i);
});

// Sem título não há o que nomear — e inventar nome seria pior que o genérico.
test('cai no genérico quando não há título para nomear', () => {
  assert.strictEqual(falaDoQueTentou([{ action: 'complete' }]), GENERICO);
  assert.strictEqual(falaDoQueTentou([]), GENERICO);
  assert.strictEqual(falaDoQueTentou(null), GENERICO);
});

// Ações de CRIAÇÃO não têm alvo a procurar: "não achei 'Comprar pão'" seria absurdo, porque
// ele não deveria achar — deveria criar. Essas seguem no genérico.
test('create não vira "não achei"', () => {
  assert.strictEqual(falaDoQueTentou([{ action: 'create', title: 'Comprar pão' }]), GENERICO);
});

test('lista longa não vira parede de texto', () => {
  const muitas = Array.from({ length: 9 }, (_, i) => ({ action: 'complete', title: `Tarefa ${i}` }));
  const t = falaDoQueTentou(muitas);
  assert.match(t, /\+\d+/); // resume o excedente
  assert.ok(t.length < 320);
});
