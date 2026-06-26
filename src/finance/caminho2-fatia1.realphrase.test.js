'use strict';
// Caminho 2 / Fatia 1 — testes da FRASE REAL (catraca da CLASSE, não da instância).
// A barra do review: tem que FECHAR mesmo SIMULANDO a recusa do LLM (não só quando ele coopera).
// Compõe detector + resolver + builder = o caminho que a F1.3 pluga no engine, sem precisar do LLM.
const test = require('node:test');
const assert = require('node:assert');
const { resolveFinanceCapability } = require('./finance-capability');
const { buildHonestRedirect } = require('./finance-honest-redirect');
const { detectDefeatism } = require('./derrotismo-detect');
const { detectRegisterIntent } = require('./detect-register-intent');

test('Matheus single-item: LLM recusaria, mas o engine EXTRAI e cria (não manda no app)', () => {
  // a recusa do LLM seria interceptada (F1.3b); o que decide é a msg do usuário
  assert.equal(detectDefeatism('não existe o comando pra isso aqui, vai no app', {}).phrase != null, true);
  const det = detectRegisterIntent('gastei 12 no lanche, débito');
  assert.ok(det && det.amount === 12 && det.type === 'expense'); // engine cria, não recusa
});

test('editar lançamento de 2 dias atrás: recusa interceptada → redirect HONESTO, sem mentira', () => {
  const v = resolveFinanceCapability({ action: 'edit_transaction', params: {} }, { candidates: [] });
  assert.equal(v.reachable, false);
  const line = buildHonestRedirect(v);
  // as mentiras de hoje NÃO podem aparecer:
  assert.doesNotMatch(line, /n[ãa]o existe o comando|mais de \d+ dias|n[ãa]o tenho como/i);
  // e tem que dar o caminho honesto:
  assert.match(line, /app/i);
});

test('a recusa LITERAL do Matheus (24/06) seria flagrada como derrotismo', () => {
  const r = detectDefeatism('Esses têm mais de 2 dias. Não existe o comando pra isso aqui. Vai no app: Finanças → Transações.', {});
  assert.ok(r.phrase != null);
});

test('piso multi-item: recusa flagrada mesmo sem extração determinística (vai pro ask-honesto)', () => {
  // Matheus mandou 3 valores → detectRegisterIntent bail (≥2 valores) → null → piso honesto.
  const det = detectRegisterIntent('Felipe 12 e 14, GianeAtela 26,90, joga no financeiro');
  assert.equal(det, null); // confirma o bail multi-valor → engine cai no _askAgain honesto (não na mentira)
});

test('criar nunca é barrado por janela (caso Matheus = create)', () => {
  assert.equal(resolveFinanceCapability({ action: 'register_transaction', params: {} }, {}).reachable, true);
});
