'use strict';

// CLOSING-RITUAL-CLOBBERS-COORD (Dudu 14/09 — finding 32161b12).
//
// 19:13:06 o TOM pergunta "Aviso o Rafinha? Confirma?" e a intent nasce CERTA, com a alça
// {coordination:{items:[…]}}. 19:16:28 o ritual de Fechamento do dia (cron, não é resposta ao
// usuário) abre a SUA intent — `kind='confirmation'` igual — e o supersede same-kind de
// `openIntent` mata a intent do recado 3min22s depois de nascida
// (`resolution:'superseded'`, note `new intent of same kind opened`, medido em produção).
// 19:16:40 o Dudu responde POR REPLY-QUOTE à pergunta do Rafinha com "Isso": a única intent
// aberta agora é a do fechamento, o "Isso" fecha ELA, e o recado cai no LLM →
// "Não consegui processar o aviso pro Rafinha dessa vez". Em seguida o "1 e 2" do fechamento
// não acha mais intent nenhuma → "_não consegui registrar agora_". As duas pontas falharam,
// TROCADAS entre si.
//
// São duas metades da mesma raiz e as duas precisam existir pro caso funcionar:
//   (1) o ritual não pode matar uma intent de OUTRA família que carrega executor;
//   (2) com as duas abertas, a citação tem de escolher a intent CITADA, não a mais nova.

const { test } = require('node:test');
const assert = require('node:assert');

const { familiaDoExecutor, intentsASuperseder } = require('./intent-executor');
const { escolheIntentPorCitacao } = require('./intent-por-citacao');

const COORD = {
  id: '13358685-0000-0000-0000-000000000000',
  kind: 'confirmation',
  question_text: 'Aviso o Rafinha? Confirma?',
  asked_at: '2026-09-14T22:13:06.000Z',
  payload: {
    coordination: {
      items: [{ mode: 'relay_assisted', recipient_name: 'Rafinha', message_body: 'ronda geral de hoje feita em todas as salas de Campo Grande.' }],
    },
  },
};

const FECHAMENTO_PAYLOAD = {
  action: 'complete',
  closing: {
    ref_date: '2026-09-14',
    items: [
      { id: 'fc016397-a865-40fb-a55b-9b7dcd4ad75c', type: 'task', index: 1, title: 'Marcar consulta com gastro novo' },
      { id: '6fd858d8-7fa8-427a-a25a-aab7db33f259', type: 'task', index: 2, title: 'Marcar nova consulta médica' },
    ],
  },
};

const FECHAMENTO = {
  id: 'eeaa9d7c-0000-0000-0000-000000000000',
  kind: 'confirmation',
  question_text: 'Fechamento do dia, Dudu\n\nDas suas 2 coisas:\n1. 🔴 *Marcar consulta com gastro novo* — fez?\n2. 🔴 *Marcar nova consulta médica* — fez?\n\nMe diz quais fez. Pode ser: "1 e 2" ou "fiz tudo" ou "só a 1".',
  asked_at: '2026-09-14T22:16:28.000Z',
  payload: FECHAMENTO_PAYLOAD,
};

// ---- (1) supersede por FAMÍLIA, não só por kind ----

test('o fechamento NÃO supersede a intent de recado viva (caso Dudu 14/09)', () => {
  assert.deepEqual(intentsASuperseder([COORD], FECHAMENTO_PAYLOAD), []);
});

test('CONTROLE — repergunta da MESMA família continua supersedendo (CONFIRM-REASK-SUPERSEDE)', () => {
  const reask = { coordination: { items: [{ recipient_name: 'Rafinha', message_body: 'outro texto' }] } };
  assert.deepEqual(intentsASuperseder([COORD], reask).map((i) => i.id), [COORD.id]);
});

test('CONTROLE — intent genérica (sem executor) continua morrendo pra qualquer nova', () => {
  const generica = { id: 'g', kind: 'confirmation', payload: { last_user_text: 'x', last_tom_reply: 'y' } };
  assert.deepEqual(intentsASuperseder([generica], FECHAMENTO_PAYLOAD).map((i) => i.id), ['g']);
  assert.deepEqual(intentsASuperseder([generica], {}).map((i) => i.id), ['g']);
});

test('CONTROLE — registrador genérico de fim-de-turno não mata mais o recado', () => {
  assert.deepEqual(intentsASuperseder([COORD], { last_user_text: 'x' }), []);
});

test('família reconhece as cinco portas e devolve null pra payload sem executor', () => {
  assert.equal(familiaDoExecutor(COORD.payload), 'coordination');
  assert.equal(familiaDoExecutor(FECHAMENTO_PAYLOAD), 'closing');
  assert.equal(familiaDoExecutor({ anchor: { id: 'x' }, action: 'complete' }), 'anchor');
  assert.equal(familiaDoExecutor({ batch_complete: ['a'] }), 'batch_complete');
  assert.equal(familiaDoExecutor({ reschedule: { actions: [{ id: 'a' }] } }), 'reschedule');
  assert.equal(familiaDoExecutor({ last_tom_reply: 'oi' }), null);
  assert.equal(familiaDoExecutor(null), null);
});

// ---- (2) com as duas abertas, a CITAÇÃO escolhe a intent ----
// `listOpenIntents` devolve mais recente primeiro: [FECHAMENTO, COORD].

test('"Isso" citando a pergunta do Rafinha escolhe a intent do RECADO, não a mais nova', () => {
  const escolhida = escolheIntentPorCitacao([FECHAMENTO, COORD], 'Aviso o Rafinha? Confirma?');
  assert.equal(escolhida && escolhida.id, COORD.id);
});

test('CONTROLE — citando o fechamento escolhe o fechamento', () => {
  const escolhida = escolheIntentPorCitacao([FECHAMENTO, COORD], 'Fechamento do dia, Dudu\n\nDas suas 2 coisas:\n1. 🔴 *Marcar consulta com gastro novo* — fez?');
  assert.equal(escolhida && escolhida.id, FECHAMENTO.id);
});

test('CONTROLE — sem citação não escolhe nada (o engine segue com a mais recente)', () => {
  assert.equal(escolheIntentPorCitacao([FECHAMENTO, COORD], ''), null);
  assert.equal(escolheIntentPorCitacao([FECHAMENTO, COORD], null), null);
});

test('CONTROLE — citação que não é de nenhuma pergunta aberta devolve null', () => {
  assert.equal(escolheIntentPorCitacao([FECHAMENTO, COORD], 'bom dia, tudo certo por aí?'), null);
});

test('CONTROLE — approval_pending nunca é escolhida por citação (tem funil próprio)', () => {
  const apr = { id: 'ap', kind: 'approval_pending', question_text: 'Aviso o Rafinha? Confirma?', payload: { token: 'T' } };
  assert.equal(escolheIntentPorCitacao([apr], 'Aviso o Rafinha? Confirma?'), null);
});
