'use strict';
// TASK-COMPLETE-REEMIT-JA-CONCLUIDA (Ana Paula 05/10 19:11 BRT). Às 19:09 ela fechou os itens
// 3 e 8 da lista de PIX automático (TASK_UPDATE executed ok=2, completed_by = ela). Às 19:11
// respondeu "3 tá ok / 8 tá ok", o LLM re-emitiu o complete por TÍTULO, o resolvedor — que só
// enxerga tarefa ABERTA — não achou nada, e o TOM disse "Não achei nenhuma tarefa aberta chamada
// … Me diz qual é que eu fecho." sobre duas tarefas que ela tinha acabado de fechar.
// Porta da TAREFA da família EVENT-CANCEL-SERIE-JA-ENCERRADA (21/09, mesma pessoa, evento).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { escolherJaConcluida, mensagemJaConcluida, JANELA_JA_CONCLUIDA_MIN } = require('./task-complete-alvo-nao-achado');

const ANA = 'f238cfb7-54ab-43a7-93ab-3f29c636fb8c';
const AGORA = Date.parse('2026-10-05T22:11:35Z');
const THIAGO = { id: 'ce3401b4-239a-44a8-b5d0-26130553d327', title: 'PIX automático — Thiago Luiz dos Santos Souto (Joanna Carolina Teixeira Sampaio dos Santos Souto, Miguel Teixeira Sampaio dos Santos Souto)', status: 'done', completed_at: '2026-10-05T22:09:16.57+00:00', completed_by: ANA };

test('Ana 05/10: tarefa fechada por ela 2min antes é reconhecida como já concluída', () => {
  const r = escolherJaConcluida([THIAGO], ANA, AGORA);
  assert.ok(r, 'o re-emit é sobre uma tarefa que ela acabou de fechar');
  assert.strictEqual(r.id, THIAGO.id);
});

test('Ana 05/10: a fala diz o estado (concluída, com hora BRT), não "não achei"', () => {
  const m = mensagemJaConcluida('PIX automático — Thiago Luiz dos Santos Souto', THIAGO.completed_at);
  assert.doesNotMatch(m, /Não achei/);
  assert.match(m, /19:09/);
  assert.match(m, /concluída/);
});

test('controle: fechada por OUTRA pessoa não conta (não é re-emit dela)', () => {
  assert.strictEqual(escolherJaConcluida([{ ...THIAGO, completed_by: 'outra' }], ANA, AGORA), null);
});

test('controle: fechada fora da janela não conta (pedido novo sobre coisa antiga segue "não achei")', () => {
  const velha = { ...THIAGO, completed_at: new Date(AGORA - (JANELA_JA_CONCLUIDA_MIN + 1) * 60000).toISOString() };
  assert.strictEqual(escolherJaConcluida([velha], ANA, AGORA), null);
});

test('controle: cancelada não é "concluída"', () => {
  assert.strictEqual(escolherJaConcluida([{ ...THIAGO, status: 'cancelled' }], ANA, AGORA), null);
});

test('engine: o ramo de alvo não achado consulta a conclusão recente ANTES de dizer "não achei"', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  const iJa = src.indexOf('escolherJaConcluida(');
  const iNao = src.indexOf('mensagemAlvoNaoAchado(a.title');
  assert.ok(iJa > 0, 'engine.js não chama escolherJaConcluida');
  assert.ok(iJa < iNao, 'a checagem de já-concluída tem que vir antes do "não achei"');
});
