// src/coordination/confirm-coord-gate.test.js
// Rodar: node --test src/coordination/confirm-coord-gate.test.js
//
// COORD-GATE-VETADO-PELO-PREAMBULO (Alf 19/08 13:10 BRT) — o gate de permissão passou a
// explicar a regra antes de propor o recado: "…quem pode REMARCAR é o dono, Yuri — convidado
// não altera a agenda dos outros. Quer que eu mande um recado propondo a mudança?".
// podeLiberarRecado rodava o veto ACAO_SOBRE_EXISTENTE no TEXTO INTEIRO, achava "remarcar"
// no PREÂMBULO e vetava — então o "Sim" não pré-confirmava e o recado era re-estagiado:
// "Aviso o Yuri? Confirma?" + segundo "Sim". Duas confirmações pro mesmo consentimento.
//
// A regra certa: o "sim" responde a PERGUNTA, não o preâmbulo. Veto e proposta passam a ser
// avaliados na última frase interrogativa — e nos DOIS a mesma frase, pra não afrouxar o
// fail-closed (proposta limpa numa frase, veto em outra, continua vetando).
const { test } = require('node:test');
const assert = require('node:assert');
const { podeLiberarRecado } = require('./confirm-coord-gate');
const { podeLiberarCriacao } = require('../utils/confirm-create-gate');
const { buildOwnerGateMessage } = require('../lib/event-owner-gate');

test('CASO REAL: preâmbulo com "remarcar" não veta a proposta de recado', () => {
  const pergunta = buildOwnerGateMessage('reschedule', 'Reunião MKT - NBG!', 'Yuri');
  assert.strictEqual(podeLiberarRecado(pergunta), true);
});
test('CASO REAL: o mesmo vale pra cancelamento', () => {
  assert.strictEqual(podeLiberarRecado(buildOwnerGateMessage('cancel', 'Reunião X', 'Yuri')), true);
});

// O fail-closed continua fechado quando a AÇÃO está na própria pergunta.
test('FAIL-CLOSED: ação sobre item existente DENTRO da pergunta segue vetada', () => {
  assert.strictEqual(podeLiberarRecado('Reagendo a reunião e aviso o time?'), false);
  assert.strictEqual(podeLiberarRecado('Cancelo a tarefa e mando recado pro João?'), false);
});
test('FAIL-CLOSED: pergunta sem proposta de recado não libera', () => {
  assert.strictEqual(podeLiberarRecado('Sobre a Reunião X: quer que eu apague tudo?'), false);
  assert.strictEqual(podeLiberarRecado('Confirma?'), false);
});
test('sem "?" nenhum, avalia o texto inteiro (comportamento antigo)', () => {
  assert.strictEqual(podeLiberarRecado('Aviso o Yuri'), true);
  assert.strictEqual(podeLiberarRecado('Reagendo e aviso o Yuri'), false);
});
test('entrada degenerada nunca libera', () => {
  for (const v of [null, undefined, '', '   ', 42]) {
    assert.strictEqual(podeLiberarRecado(v), false);
  }
});
// Regressão do comportamento original (Fatia 8): proposta simples de recado segue liberando.
test('ZERO-REGRESSÃO: propostas simples de recado continuam liberando', () => {
  assert.strictEqual(podeLiberarRecado('Mando um agradecimento pro Rodrigo?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso a Fabi?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso 3 pessoas?'), true);
});

// COORD-GATE-APAGADO-PELA-TAG (Clayton 29/08 08:53 BRT, finding 89d9734e).
// A casa fecha proposta com uma tag SEM conteúdo ("… ? Confirma?" / "… ? Certo?"), e a
// ultimaPergunta devolvia justamente essa tag — PROPOE_RECADO nunca casava e o gate ficava
// apagado. Clayton: "Agradece ele" → TOM "Mando um agradecimento pro Rafinha? Confirma?" →
// "Sim" (17 min depois) → CONFIRM_NOEXEC skipped → "não consegui enviar. Me diz o texto
// exato". A MESMA conversa mostra o fluxo funcionando 43 min antes, quando a Fatia 3 tinha
// conseguido estagiar o draft. Nas perguntas gravadas em CONFIRM_NOEXEC o gate liberava 1 e
// ficava apagado por causa da tag em 5.
test('CASO REAL Clayton 29/08: a tag final "Confirma?" não pode apagar a proposta', () => {
  assert.strictEqual(podeLiberarRecado('Mando um agradecimento pro Rafinha? Confirma?'), true);
});
test('CASO REAL: as outras perguntas apagadas pela tag (fixtures de CONFIRM_NOEXEC)', () => {
  assert.strictEqual(podeLiberarRecado('Aviso o Alf sobre os calendários das escolas? Confirma?'), true);
  assert.strictEqual(podeLiberarRecado('Aviso a Krissya amanhã às 18h40 pra pegar os fones em CG? Confirma?'), true);
});
// NÃO é caso deste gate, apesar de PROPOE_RECADO casar "mandar mensagem" no texto inteiro:
// "lembrete amanhã às 11h" é proposta de CRIAÇÃO, e o create-gate — que tem precedência no
// engine.js — já libera. Medido: podeLiberarCriacao(...) === true. Fica registrado pra uma
// próxima rodada não reclassificar isto como recado apagado.
test('não-alvo: proposta de CRIAÇÃO com verbo de recado no meio fica com o create-gate', () => {
  const q = 'Entendi: lembrete amanhã às 11h — mandar mensagem pro *Rômulo Massagista*.\n\nCerto?';
  assert.strictEqual(podeLiberarCriacao(q), true);
});
// O fail-closed NÃO pode afrouxar: pular a tag expõe a frase da proposta ao MESMO veto.
test('FAIL-CLOSED: pular a tag não desarma o veto de ação sobre item existente', () => {
  assert.strictEqual(podeLiberarRecado('Cancelo a reunião e aviso o Yuri? Confirma?'), false);
  assert.strictEqual(podeLiberarRecado('Reagendo a reunião? Certo?'), false);
  assert.strictEqual(podeLiberarRecado('Crio a tarefa pra amanhã? Confirma?'), false);
});
// Tag sozinha, sem proposta antes, segue sem liberar.
test('FAIL-CLOSED: só a tag, sem proposta anterior, não libera', () => {
  assert.strictEqual(podeLiberarRecado('Confirma?'), false);
  assert.strictEqual(podeLiberarRecado('Certo?'), false);
  assert.strictEqual(podeLiberarRecado('Tudo certo por aí? Confirma?'), false);
});
