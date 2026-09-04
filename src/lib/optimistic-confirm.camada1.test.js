'use strict';
// Camada 1 — chokepoint anti-confabulação (CONFAB-NOMARKER-CHOKEPOINT).
// Testa hasCompletionClaim (gate verbo-baseado) + enforceNoMarkerHonesty.
const test = require('node:test');
const assert = require('node:assert');
const { hasCompletionClaim, enforceNoMarkerHonesty } = require('./optimistic-confirm');

const PERSIST_NO = { nothingPersisted: true, infoGathering: false, awaitingConfirm: false };

test('hasCompletionClaim: Ana (✅ + verbo no fim) = true', () => {
  assert.strictEqual(hasCompletionClaim('✅ Alice com a bombinha em dia — as duas doses confirmadas!'), true);
});
test('hasCompletionClaim: Rose (✅ + lançado) = true', () => {
  assert.strictEqual(hasCompletionClaim('✅ Lançado nas parcelas jul/ago/set'), true);
});
test('hasCompletionClaim: ✅ decorativo sem verbo = false', () => {
  assert.strictEqual(hasCompletionClaim('✅ Boa! Tá tudo certo por aí?'), false);
});
test('hasCompletionClaim: referência a ação passada sem ✅ = false', () => {
  assert.strictEqual(hasCompletionClaim('O evento que você criou semana passada tá lá na agenda'), false);
});

test('enforce: Ana rebaixa (remove a linha falsa + aviso)', () => {
  const out = enforceNoMarkerHonesty('✅ as duas doses confirmadas!', PERSIST_NO);
  assert.ok(!/confirmadas/i.test(out), 'a confirmação falsa devia sumir: ' + out);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), 'devia ter aviso honesto: ' + out);
});
test('enforce: Rose rebaixa', () => {
  const out = enforceNoMarkerHonesty('✅ Lançado nas parcelas jul/ago/set', PERSIST_NO);
  assert.ok(!/lançado/i.test(out), out);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), out);
});
test('enforce NÃO mexe: ✅ decorativo', () => {
  const t = '✅ Boa! Tá tudo certo por aí?';
  assert.strictEqual(enforceNoMarkerHonesty(t, PERSIST_NO), t);
});
test('enforce NÃO mexe: algo persistiu (nothingPersisted=false)', () => {
  const t = '✅ Tarefa criada!';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: false, infoGathering: false, awaitingConfirm: false }), t);
});
// CONTRATO INVERTIDO em 10/08 — HABIT-UPDATE-SILENT-LIE (Bianca 09/08 08:30).
//
// Este teste afirmava que "✅ Criado! Quer que eu marque a hora?" com ZERO persistido devia
// passar intacto, porque a pergunta o classificava como info-gathering. Era sintético: sem caso
// real citado, ao contrário dos vizinhos (Ana, Rose, Dai) — documentava o gate, não um
// comportamento observado que valesse proteger. E a estrutura que ele abençoava é exatamente a
// que enganou a Bianca: "Entendi: quer tirar o lembrete das 6h, certo?" + "✅ Lembrete removido",
// com o marker rejeitado. Ela respondeu "Certo" e o lembrete continua tocando às 6h.
//
// Uma pergunta ao lado não torna a afirmação verdadeira. Como o TOM foi ENSINADO a confirmar
// antes de agir, perguntar-e-afirmar é o padrão dele — então o veto deixava a porta aberta
// justamente no caminho mais comum, não num canto raro.
test('info-gathering NÃO inocenta claim forte sem persistência (era o buraco da Bianca)', () => {
  const t = '✅ Criado! Quer que eu marque a hora?';
  const out = enforceNoMarkerHonesty(t, { nothingPersisted: true, infoGathering: true, awaitingConfirm: false });
  assert.ok(!/criado/i.test(out), `a confirmação falsa sobreviveu: ${out}`);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), `devia ter aviso honesto: ${out}`);
  // A pergunta cai junto QUANDO divide a linha com o claim: o sanitizador opera por linha, e
  // separar oração dentro da linha seria reescrever a fala do TOM. Perder a pergunta é ruim,
  // mas o aviso já pede pra mandar de novo — e o alternativo é entregar a mentira inteira.
  // Em linha separada (que é o formato real do caso Bianca) ela sobrevive: ver o teste
  // "SILENT-LIE: a pergunta sobrevive ao rebaixamento" em optimistic-confirm.test.js.
});
// O veto do info-gathering continua de pé onde ele foi feito pra servir: a camada FRACA, em que
// a pergunta É o sinal de que aquilo é banter e não promessa (CHOKEPOINT-PROGRESS-FALSEFIRE).
test('enforce NÃO mexe: claim FRACA + infoGathering segue vetada', () => {
  const t = 'Beleza! Quer que eu veja mais alguma coisa?';
  assert.strictEqual(enforceNoMarkerHonesty(t,
    { nothingPersisted: true, infoGathering: true, awaitingConfirm: false, pendingActionRecent: true }), t);
});
test('enforce NÃO mexe: awaitingConfirm', () => {
  const t = '✅ Confirmado, crio as duas?';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: true, infoGathering: false, awaitingConfirm: true }), t);
});

// PLANNING-CONFIRM-NO-CREATE (caso Dai 21/06) — claim de planejamento sem marker.
test('enforce: caso Dai — "Semana organizada / te cobro" rebaixa (planejamento sem marker)', () => {
  const dai = 'Show, Dai! Semana do canto organizada então:\n\n• Campo Grande — terça\n• Recreio — quinta\n\nTe cobro conforme for chegando.';
  const out = enforceNoMarkerHonesty(dai, PERSIST_NO);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), 'devia ter aviso honesto: ' + out);
});
test('hasCompletionClaim: pega claim de planejamento (organizada / te cobro conforme / organizei)', () => {
  assert.strictEqual(hasCompletionClaim('Semana do canto organizada então:'), true);
  assert.strictEqual(hasCompletionClaim('Te cobro conforme for chegando.'), true);
  assert.strictEqual(hasCompletionClaim('Organizei sua semana.'), true);
});
test('enforce NÃO mexe: "te cobro segunda" (reschedule, sem conforme/quando)', () => {
  const t = 'Beleza, te cobro segunda!';
  assert.strictEqual(enforceNoMarkerHonesty(t, PERSIST_NO), t);
});

// Caminho 2 / Fatia 0 — modo meta (velocímetro): retorna {reply, fired, sense}.
test('meta: sinaliza fired+sense=confab quando rebaixa', () => {
  const out = enforceNoMarkerHonesty('✅ Lançado nas parcelas jul/ago/set', PERSIST_NO, { meta: true });
  assert.strictEqual(out.fired, true);
  assert.strictEqual(out.sense, 'confab');
  assert.ok(typeof out.reply === 'string' && /n[ãa]o consegui registrar/i.test(out.reply), out.reply);
});
test('meta: fired=false quando algo persistiu', () => {
  const out = enforceNoMarkerHonesty('✅ Tarefa criada!', { nothingPersisted: false }, { meta: true });
  assert.strictEqual(out.fired, false);
  assert.strictEqual(out.reply, '✅ Tarefa criada!');
});
test('meta: fired=false em ✅ decorativo (protege a voz)', () => {
  assert.strictEqual(enforceNoMarkerHonesty('✅ Boa! Tá tudo certo?', PERSIST_NO, { meta: true }).fired, false);
});
test('retrocompat: sem meta retorna string (não objeto)', () => {
  assert.strictEqual(typeof enforceNoMarkerHonesty('✅ Lançado', PERSIST_NO), 'string');
});

// =====================================================================================
// CHOKEPOINT-FALSEFIRE-ESTADO-RELATADO (04/09) — a guarda gritava em falso quando o TOM
// RELATAVA o que outra pessoa fez ou INFERIA estado do mundo. O veto e OPT-IN: sem o opt,
// nada muda para o 1:1 (que carrega tuning de meses). Ver isReportedStateClaim.
// =====================================================================================
const { isReportedStateClaim } = require('./optimistic-confirm');

test('relato: participio com AGENTE de terceiro nomeado ("pela Krissya")', () => {
  assert.strictEqual(isReportedStateClaim('Ainda tem 27 anamneses abertas — todas criadas pela Krissya pra hoje.'), true);
});

test('relato: inferencia hedgeada ("o que indica que ... provavelmente")', () => {
  assert.strictEqual(isReportedStateClaim('O que indica que todas as anamneses ja foram concluidas (provavelmente quando a Krissya passou por elas).'), true);
});

test('CINTO 1: 1a pessoa desarma o veto — "criei" e o TOM falando da PROPRIA escrita', () => {
  assert.strictEqual(isReportedStateClaim('Criei todas as tarefas pedidas pela Krissya.'), false);
});

test('CINTO 1: emoji de sucesso desarma o veto', () => {
  assert.strictEqual(isReportedStateClaim('✅ Todas concluidas pela Krissya.'), false);
});

test('CINTO 2: uma linha honesta ao lado NAO absolve a linha que afirma escrita', () => {
  assert.strictEqual(isReportedStateClaim('Todas criadas pela Krissya.\nTodas as suas tarefas foram fechadas.'), false);
});

test('CINTO 3: agente GENERICO ("pelo sistema") nao conta — e como um confab se esconderia', () => {
  assert.strictEqual(isReportedStateClaim('Todas as tarefas foram criadas pelo sistema.'), false);
});

test('sem alegacao de conclusao nenhuma, nao ha o que vetar', () => {
  assert.strictEqual(isReportedStateClaim('Bom dia, pessoal!'), false);
  assert.strictEqual(isReportedStateClaim(''), false);
});

test('OPT-IN: sem o opt reportedState a guarda dispara exatamente como antes', () => {
  const fala = 'Ainda tem 27 anamneses abertas — todas criadas pela Krissya pra hoje.';
  assert.match(enforceNoMarkerHonesty(fala, PERSIST_NO), /não consegui registrar/i);
});

test('com o opt ligado, a resposta informativa passa intacta', () => {
  const fala = 'Ainda tem 27 anamneses abertas — todas criadas pela Krissya pra hoje.';
  assert.strictEqual(enforceNoMarkerHonesty(fala, { ...PERSIST_NO, reportedState: true }), fala);
});

test('marker TENTADO-e-rejeitado mantem o freio mesmo com reportedState', () => {
  const fala = 'Ainda tem 27 anamneses abertas — todas criadas pela Krissya pra hoje.';
  assert.match(enforceNoMarkerHonesty(fala, { ...PERSIST_NO, reportedState: true, markerAttempted: true }),
    /não consegui registrar/i);
});
