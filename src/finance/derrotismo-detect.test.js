'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectDefeatism, isFinanceCapabilityDenial } = require('./derrotismo-detect');

test('pega a recusa literal do Matheus (24/06)', () => {
  const r = detectDefeatism('não tenho como editar transações financeiras pelo chat. Não existe o comando pra isso aqui, independente de quando foi o lançamento.', { actionableIntent: true, markerEmitted: false });
  assert.equal(r.suspect, true);
});
test('pega "faz mais de 2 dias" (regra inventada)', () => {
  assert.equal(detectDefeatism('Esses têm mais de 2 dias, então não alcança mais pelo chat.', { actionableIntent: true, markerEmitted: false }).suspect, true);
});
test('pega "vai (direto) no app" sem marker', () => {
  assert.equal(detectDefeatism('Vai direto no app: Finanças → Transações → toca no lançamento', { actionableIntent: true, markerEmitted: false }).suspect, true);
});
test('NÃO flagueia quando houve marker (TOM agiu)', () => {
  assert.equal(detectDefeatism('Pronto, ajustei pra você', { actionableIntent: true, markerEmitted: true }).suspect, false);
});
test('NÃO flagueia sem intent acionável (conversa solta)', () => {
  assert.equal(detectDefeatism('não tenho como saber disso, hein', { actionableIntent: false, markerEmitted: false }).suspect, false);
});
test('NÃO flagueia o redirect honesto (Modelo α): "no app você resolve em segundos"', () => {
  // o construtor negativo NÃO pode disparar o detector de derrotismo (não é recusa-mentira)
  assert.equal(detectDefeatism('Esse lançamento já tá fora das ~2h que eu alcanço — mas no app você resolve em segundos: Finanças → Transações.', { actionableIntent: true, markerEmitted: false }).suspect, false);
});

// FINGUARD-DEFEATISM-CROSSDOMAIN-HIJACK (Ana 27/06) — limitação HONESTA de encaminhar mídia
// NÃO é derrotismo. O interceptor de finança (engine 11040) lê só .phrase; com phrase!=null +
// skill financeira ativa, ele sequestrava a resposta certa (relay) e mandava o ask-honest de
// gastos. "Não consigo encaminhar a imagem" caía no \bnão consigo\b genérico. A exclusão de
// mídia mata o caso Ana SEM tocar o resgate real do Matheus (que casa por outras alternâncias).
test('Ana: "não consigo encaminhar a imagem" NÃO é derrotismo (phrase=null)', () => {
  const r = detectDefeatism('Mandando o contato do Leandro pro Jereh agora! Não consigo encaminhar a imagem em si, mas passo os dados extraídos dela.', {});
  assert.equal(r.phrase, null);
});
test('variante mídia: "não consigo enviar o áudio" → phrase=null', () => {
  assert.equal(detectDefeatism('não consigo enviar o áudio, mas transcrevo pra você', {}).phrase, null);
});
test('variante mídia: "não consigo mandar o print" → phrase=null', () => {
  assert.equal(detectDefeatism('não consigo mandar o print, mas descrevo o que aparece', {}).phrase, null);
});
test('Matheus intacto: "não existe o comando... vai no app" → phrase != null', () => {
  assert.notEqual(detectDefeatism('não existe o comando pra isso aqui. Vai no app.', {}).phrase, null);
});
test('Matheus intacto: "não tenho como editar pelo chat" → phrase != null', () => {
  assert.notEqual(detectDefeatism('não tenho como editar pelo chat', {}).phrase, null);
});
test('finança real com "não consigo" (não-mídia) → phrase != null', () => {
  assert.notEqual(detectDefeatism('não consigo lançar esse gasto', {}).phrase, null);
});
test('coexistência: mídia honesta + derrotismo financeiro real → mantém (phrase != null)', () => {
  assert.notEqual(detectDefeatism('não consigo enviar a foto. E vai no app pra editar', {}).phrase, null);
});

// ── isFinanceCapabilityDenial (RECUSA-FALSA-CAI-COM-SKILL, raiz) ─────────────────
// A rede de derrotismo é gated em skill_active==='financeiro-pessoal'; no turno de follow-up/
// esclarecimento a skill cai e a recusa falsa passa (Rose/Matheus/Juliana/9a0a173a). Este
// predicado escopa a rede por DOMÍNIO (recusa de capacidade FINANCEIRA na fala), desacoplando-a
// da skill. Preciso: recusa/redirect + objeto financeiro NA MESMA cláusula, exceto find/consulta.
test('Juliana 13/07: "não consigo registrar lançamentos financeiros direto por aqui" → true', () => {
  assert.equal(isFinanceCapabilityDenial('Entendi, é despesa pessoal da área financeira. Mas não consigo registrar lançamentos financeiros direto por aqui — isso você gerencia no app de finanças.'), true);
});
test('Rose: "não consigo executar o lançamento por aqui" → true', () => {
  assert.equal(isFinanceCapabilityDenial('Pô, não consigo executar o lançamento por aqui diretamente.'), true);
});
test('Matheus: "lançamento financeiro eu não consigo salvar pelo chat" → true', () => {
  assert.equal(isFinanceCapabilityDenial('Pô Matheus, lançamento financeiro eu não consigo salvar pelo chat com segurança — precisa ser direto no app.'), true);
});
test('Matheus2: "não consigo salvar transações financeiras" → true', () => {
  assert.equal(isFinanceCapabilityDenial('por aqui não consigo salvar transações financeiras, não tenho como lançar isso direto no módulo de finanças.'), true);
});
test('estorno em cartão (d2c98e92): "esse lançamento de estorno... não consigo fazer pelo chat" → true', () => {
  assert.equal(isFinanceCapabilityDenial('Rose, esse lançamento de estorno em cartão de crédito ainda não consigo fazer pelo chat — precisa ser direto no app.'), true);
});

// FAIL-CLOSED / negativos — não pode sequestrar recusa NÃO-financeira nem limitação honesta.
test('mídia honesta "não consigo encaminhar a imagem" → false', () => {
  assert.equal(isFinanceCapabilityDenial('Não consigo encaminhar a imagem em si, mas passo os dados.'), false);
});
test('defeatism não-financeiro "não tenho como acessar seu email" → false', () => {
  assert.equal(isFinanceCapabilityDenial('não tenho como acessar seu email, isso é fora do meu alcance'), false);
});
test('limitação de CONSULTA "não consigo achar essa transação" → false (não é recusa de capacidade)', () => {
  assert.equal(isFinanceCapabilityDenial('não consigo achar essa transação no seu histórico'), false);
});
test('redirect honesto não-financeiro "vai no app: Agenda" → false', () => {
  assert.equal(isFinanceCapabilityDenial('Esse evento vai direto no app: Agenda → Novo.'), false);
});
test('vazio/nulo/não-string → false sem lançar', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) assert.equal(isFinanceCapabilityDenial(v), false);
});
