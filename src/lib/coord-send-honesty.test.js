'use strict';
// COORD-SEND-CONFAB-STRIP (Ana 30/06) — rodar: node --test src/lib/coord-send-honesty.test.js
const test = require('node:test');
const assert = require('node:assert');
const { stripOptimisticSendLines, claimsSent, enforceSendHonesty } = require('./coord-send-honesty');

test('Ana: "📨 Avisado! Mandando pro grupo ADM GERAL agora." é removido por inteiro', () => {
  const out = stripOptimisticSendLines('📨 Avisado! Mandando pro grupo ADM GERAL agora.');
  assert.strictEqual(out, '', 'a única linha era falsa afirmação de envio → some');
});

test('Ana (integração): sem contradição — só o aviso honesto sobra', () => {
  const clean = stripOptimisticSendLines('📨 Avisado! Mandando pro grupo ADM GERAL agora.');
  const DISCLAIMER = '_⚠️ Tive um problema técnico e não consegui enviar o recado — ninguém foi avisado ainda. Me passa de novo pra quem e o quê você quer mandar?_';
  const reply = clean ? `${clean}\n\n${DISCLAIMER}` : DISCLAIMER;
  // a prosa OTIMISTA some; o disclaimer honesto (que contém "ninguém foi avisado") fica.
  assert.ok(!/Avisado!/.test(reply), 'a afirmação otimista "Avisado!" some');
  assert.ok(!/Mandando/i.test(reply), 'não pode dizer "Mandando agora"');
  assert.ok(!/📨/.test(reply), 'o emoji de envio otimista some junto com a linha');
  assert.match(reply, /ninguém foi avisado/, 'o aviso honesto permanece');
});

test('Daiana 05/06: "📨 Avisei a Anne" removido', () => {
  assert.strictEqual(stripOptimisticSendLines('📨 Avisei a Anne'), '');
});

test('claimsSent detecta a mentira (gate)', () => {
  assert.strictEqual(claimsSent('Avisado! Mandando agora'), true);
  assert.strictEqual(claimsSent('Beleza, vou ver isso'), false);
});

test('linha NEUTRA é preservada; só a de envio some', () => {
  const out = stripOptimisticSendLines('Beleza, Ana!\n📨 Avisado! Mandando pro grupo agora.');
  assert.strictEqual(out, 'Beleza, Ana!');
});

test('gerúndio "Enviando pro grupo" também some', () => {
  assert.strictEqual(stripOptimisticSendLines('Enviando pro grupo ADM agora!'), '');
});

test('CONTROLE: pergunta legítima de rascunho NÃO é send-claim (não some indevido)', () => {
  // "Quer que eu avise a Vitoria com esse texto?" é uma PERGUNTA, não afirmação de envio.
  // Contém "avise" (subjuntivo) — garantir que o RE não casa formas de pergunta.
  const s = 'Quer que eu avise a Vitoria com esse texto?';
  assert.strictEqual(claimsSent(s), false, '"avise" (pedido) não é afirmação de envio');
  assert.strictEqual(stripOptimisticSendLines(s), s);
});

test('CONTROLE: texto vazio/nulo é seguro', () => {
  assert.strictEqual(stripOptimisticSendLines(''), '');
  assert.strictEqual(stripOptimisticSendLines(null), '');
  assert.strictEqual(claimsSent(null), false);
});

// ── enforceSendHonesty (SEND-CLAIM-NOMARKER, audit 01/07 Reunião Time Gestão) ────────
// Confab "avisar sem marker": a fala afirma envio a pessoas mas NENHUM COORDINATION_REQUEST
// foi emitido (o engine só chama isto no ramo sem-coord-marker). Rebaixa: strip + aviso honesto.

test('Reunião Time Gestão: "mandando o convite pra cada um dos 8" (sem coord marker) → rebaixado', () => {
  const r = enforceSendHonesty('Beleza, Alf! Criando o compromisso e mandando o convite pra cada um dos 8.', { isQuestion: false });
  assert.strictEqual(r.fired, true, 'a afirmação de envio sem marker tem que ser pega');
  assert.ok(!/mandando o convite/i.test(r.reply), 'a falsa afirmação de envio some');
  assert.match(r.reply, /N[ÃA]O avisei/i, 'entra o aviso honesto ("NÃO avisei ninguém")');
});

test('enforceSendHonesty: sem afirmação de envio → não age (reply intacto)', () => {
  const r = enforceSendHonesty('Beleza, tá tudo certo por aqui!', {});
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, 'Beleza, tá tudo certo por aqui!');
});

test('enforceSendHonesty: pergunta não dispara (respeita isQuestion)', () => {
  const r = enforceSendHonesty('Mandei o convite, quer que eu confirme com cada um?', { isQuestion: true });
  assert.strictEqual(r.fired, false, 'pergunta/rascunho não é rebaixada');
});

test('enforceSendHonesty: preserva a linha verdadeira, tira só a de envio + aviso honesto', () => {
  const r = enforceSendHonesty('✅ Reunião criada pra sexta 9h!\nMandando o convite pra todos os 8.', {});
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /Reunião criada pra sexta/, 'o que é verdade (evento criado) permanece');
  assert.ok(!/Mandando o convite/i.test(r.reply), 'a linha de falso-envio some');
  assert.match(r.reply, /N[ÃA]O avisei/i);
});

test('enforceSendHonesty: reply 100% falso-envio vira só o aviso honesto', () => {
  const r = enforceSendHonesty('Avisei todo mundo agora!', {});
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /N[ÃA]O avisei/i);
});

// ── Regex gap (audit 01/07, 2ª evidência): passiva/plural "já foram mandados" ──────────
test('confab passiva/plural é send-claim: "já foram mandados/enviados/avisados"', () => {
  assert.strictEqual(claimsSent('Os convites pros 8 já foram mandados nessa correção anterior.'), true, 'mandados');
  assert.strictEqual(claimsSent('Os convites já foram enviados.'), true, 'enviados');
  assert.strictEqual(claimsSent('Todos já foram avisados.'), true, 'avisados');
  assert.strictEqual(claimsSent('Os recados foram repassados.'), true, 'repassados');
  assert.strictEqual(claimsSent('Os convites foram encaminhados.'), true, 'encaminhados');
});

test('enforceSendHonesty pega a confab "os convites já foram mandados na correção anterior"', () => {
  const r = enforceSendHonesty('Show, fechado — sexta 03/07 9h já tá valendo. Os convites pros 8 já foram mandados nessa correção anterior, então não vou reenviar de novo pra não duplicar.', {});
  assert.strictEqual(r.fired, true);
  assert.ok(!/já foram mandados/i.test(r.reply), 'a linha do falso "já foram mandados" some');
  assert.match(r.reply, /N[ÃA]O avisei/i);
});

test('CONTROLE: "convidados" (as pessoas) NÃO é send-claim', () => {
  assert.strictEqual(claimsSent('A reunião tem 8 convidados.'), false, '"convidados" é substantivo, não envio');
  assert.strictEqual(claimsSent('Confirmei com os convidados?'), false);
});

test('CONTROLE: "comunicados" (o módulo) NÃO é send-claim', () => {
  assert.strictEqual(claimsSent('Você tem 3 comunicados pendentes de aprovação.'), false);
});

// ── FALSO-FIRE FINANCE (Rose 14/07 18:00): "cartão LATAM PASS" no fluxo de fatura → o LLM
// respondeu a lista organizada (1743 tok), o guard casou "mandando/enviado" (sentido FINANCEIRO:
// lançar na fatura / o PDF que ELA enviou), TODAS as linhas caíram e a Rose recebeu SÓ o
// disclaimer de coordenação ("não avisei ninguém — me diz pra quem mandar") num papo de fatura.
// Regra: mand*/envi* (genéricos) só são send-claim COM contexto de recado na MESMA linha;
// avis*/repass*/encaminh*/comuniqu*/transmit* (inequívocos de recado) seguem disparando sozinhos.
test('ROSE 14/07: "mandar/enviar" em contexto de FATURA não é send-claim', () => {
  assert.strictEqual(claimsSent('Perfeito! Mandando tudo pra fatura de julho do LATAM PASS.'), false);
  assert.strictEqual(claimsSent('Organizei com base no PDF enviado — 62 itens da fatura.'), false);
  assert.strictEqual(claimsSent('Os 62 itens foram enviados pra fatura de julho do cartão.'), false);
  assert.strictEqual(claimsSent('Lista montada com a fatura que você mandou. Enviado pro seu financeiro.'), false);
});
test('ROSE 14/07 (integração): resposta de fatura passa INTACTA', () => {
  const s = '💳 *Latam PASS · fatura de julho*\n1. 03/06 IFD*PIZZAS · R$ 87,79\nMandando os 62 itens pra fatura de julho.';
  const r = enforceSendHonesty(s, { isQuestion: false });
  assert.strictEqual(r.fired, false, 'sem contexto de recado, não dispara');
  assert.strictEqual(r.reply, s);
});
test('regressão: coordenação REAL segue disparando (mand/envi COM contexto de recado)', () => {
  assert.strictEqual(claimsSent('Mandando o recado pra ela agora.'), true);
  assert.strictEqual(claimsSent('Enviei a mensagem no grupo.'), true);
  assert.strictEqual(claimsSent('Mandei o convite pra equipe.'), true);
  assert.strictEqual(claimsSent('Avisei que a fatura fechou.'), true, 'avisar é inequívoco, dispara sozinho');
});

// ── CINTO: reply LONGO que ficaria 100% destruído = overreach de regex → NÃO dispara.
// O guard nunca pode destruir mais do que salva (a lista real da Rose virou só disclaimer).
// Claim real de coordenação é curto (1-2 linhas) ou vem DENTRO de um reply maior (strip parcial).
test('cinto: reply longo 100% "matcheado" não vira disclaimer-only', () => {
  const long = ('Avisei o grupo sobre o recado de novo.\n').repeat(8).trim(); // >160 chars, todas as linhas casam
  const r = enforceSendHonesty(long, { isQuestion: false });
  assert.strictEqual(r.fired, false, 'destruição total de reply longo = falso-positivo presumido');
  assert.strictEqual(r.reply, long);
});
test('cinto NÃO protege claim curto: "Avisei todo mundo agora!" segue rebaixado', () => {
  const r = enforceSendHonesty('Avisei todo mundo agora!', {});
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /N[ÃA]O avisei/i);
});
