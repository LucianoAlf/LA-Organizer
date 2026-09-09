'use strict';
// portas-honestidade-fronteira.test.js — a FRONTEIRA entre as duas portas, medida em 09/09/2026.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// `downgradeEmptyPromise` (porta de CIMA, promise-honesty.js) levou CINCO consertos em 24 dias:
//
//   16/08  CONFAB-INVERSO-OFERTA-CONDICIONAL     oferta condicional casava a RE
//   29/08  PROMISE-DOWNGRADE-COLAPSA-PARAGRAFO   dropar linha em branco comia o separador
//   31/08  PROMISE-DOWNGRADE-REBAIXA-ADMISSAO    admissão de falha virava disclaimer genérico
//   05/09  PROMISE-STRIP-LINHA-COME-FRASE-BOA    strip por linha comia a frase verdadeira
//   09/09  PROMISE-NOMARKER-CEGO-PRA-ESCRITA-RECENTE  reafirmação de escrita recente
//
// Cinco cirurgias no mesmo lugar em menos de um mês é sinal de arquitetura, não de bug — e a
// trava da ETAPA 1, que manda parar de remendar família reincidente, nunca disparou porque o
// sensor dela estava cego (ver `sensores_regressao` no health-check).
//
// A HIPÓTESE QUE EU TESTEI E QUE ESTÁ ERRADA
//
// A porta de cima se chama "promessa vazia" mas seu detector casa verbos de CONCLUSÃO no
// passado (`registrei`, `anotado`, `criei`). Conclusão é o domínio da porta de BAIXO
// (`enforceNoMarkerHonesty`), que tem NOVE vetos contra os DOIS daqui. Parecia claro: devolver
// a conclusão passada pra porta de baixo mataria a fonte das cinco cirurgias.
//
// Medi antes de embarcar, e o número disse não. Os oito casos abaixo são os que a suíte já
// protegia; se a porta de cima devolvesse, a de baixo pegaria só TRÊS. Os cinco restantes —
// incluindo "Tá anotado", que é exatamente a promessa vazia que o guard existe pra pegar —
// ficariam órfãos entre as duas portas. Porta errada julgando é ruim; NINGUÉM julgando é pior.
//
// O QUE ISSO REVELA, E QUE VALE MAIS QUE O CONSERTO QUE NÃO FIZ
//
// As duas portas não são redundantes nem sobrepostas por acidente de escopo: elas têm
// DETECTORES DIFERENTES E INCOMPLETOS, e cada uma pega um subconjunto que a outra perde.
// A de cima pega "Tá anotado"; a de baixo pega "Beleza, anotado!". Elas se complementam por
// acidente histórico, não por desenho — e é por isso que consertar uma sozinha nunca acaba.
//
// Unificar de verdade = fundir os dois DETECTORES num só, com os nove vetos. Isso é refatoração
// com risco em produção, não conserto de rodada, e precisa de desenho antes.
//
// ATÉ LÁ, ESTE ARQUIVO É A TRAVA. Ele fixa a fronteira medida. Quem tentar mover a linha vê
// na hora quanto custa — em vez de descobrir pelo incidente da pessoa do outro lado.

const { test } = require('node:test');
const assert = require('node:assert');
const { downgradeEmptyPromise } = require('./promise-honesty');
const { hasCompletionClaim, hasWeakCompletionClaim } = require('./optimistic-confirm');

const pegaEmBaixo = (t) => !!(hasCompletionClaim(t) || hasWeakCompletionClaim(t));

// Casos reais, com a origem. Todos disparam a porta de CIMA hoje.
const SO_A_DE_CIMA_PEGA = [
  ['Dudu 27/08', 'Tá anotado, Dudu! Os cabos vão pro pacote da semana.'],
  ['negação de outra ação', 'Não consegui criar o evento, mas já registrei a tarefa.'],
  ['negação do verbo seguinte', 'Não registrei ainda, mas anotei o pedido aqui.'],
  ['linha sem fim de frase', 'Tá anotado aqui'],
  ['reafirmação (Rafinha 08/09)', 'No áudio anterior eu registrei "filhos no Marvin".'],
];

const AS_DUAS_PEGAM = [
  ['"eu" longe do gatilho', 'Registrei o pedido. Amanhã eu passo na loja.'],
  ['Ana 04/09', 'Beleza, anotado! A Mayra segue com isso pra amanhã.'],
  ['frase sem promessa junto', 'Anotado! O Rafinha já foi avisado.'],
];

test('a porta de cima é a ÚNICA que pega estes cinco — devolver seria perdê-los', () => {
  for (const [nome, txt] of SO_A_DE_CIMA_PEGA) {
    assert.strictEqual(downgradeEmptyPromise(txt).fired, true,
      `a porta de cima tem que pegar: ${nome}`);
    assert.strictEqual(pegaEmBaixo(txt), false,
      `se este caso passar a ser pego em baixo, a devolução ficou SEGURA — revisite a fronteira: ${nome}`);
  }
});

test('nestes três as duas portas pegam — só aqui a devolução seria composição', () => {
  for (const [nome, txt] of AS_DUAS_PEGAM) {
    assert.strictEqual(downgradeEmptyPromise(txt).fired, true, `porta de cima: ${nome}`);
    assert.strictEqual(pegaEmBaixo(txt), true, `porta de baixo: ${nome}`);
  }
});

test('a fronteira medida é 3 de 8 — este número é o custo da devolução', () => {
  const todos = [...SO_A_DE_CIMA_PEGA, ...AS_DUAS_PEGAM];
  const cobertos = todos.filter(([, t]) => pegaEmBaixo(t)).length;
  assert.strictEqual(cobertos, 3,
    'se este número subir para 8, a porta de baixo passou a cobrir tudo e a unificação virou '
    + 'segura — mude o detector, não este teste');
  assert.strictEqual(todos.length, 8);
});

test('o alvo original da porta de cima segue sendo dela', () => {
  // Codex pós-timeout, 01/07 — o caso que criou a porta. Promessa FUTURA sem lastro não é
  // conclusão e nunca foi domínio da porta de baixo.
  const alvo = 'Vou criar na agenda e disparar pros 8 confirmarem presença.';
  assert.strictEqual(downgradeEmptyPromise(alvo).fired, true);
  assert.strictEqual(pegaEmBaixo(alvo), false,
    'promessa futura não é claim de conclusão — as portas são de eixos diferentes');
});
