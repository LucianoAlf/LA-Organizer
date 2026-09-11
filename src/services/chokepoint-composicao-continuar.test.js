const { test } = require('node:test');
const assert = require('node:assert');
const { isContentSolicitationReply } = require('./reply-classify');
const { enforceNoMarkerHonesty } = require('../lib/optimistic-confirm');

// Casos reais do Dudu, ditando um relatório EM PARTES. Literais de marker_logs
// (raw_excerpt guarda a resposta ORIGINAL desde 21/08).
//
// 10/09/2026 19:28:07 BRT — achado 785e1c61. Ele listou instrumentos e loja e disse
// "Tem mais coisas."; o TOM resumiu o que entendeu e PEDIU o resto. O chokepoint leu
// "tudo organizado" como confab, APAGOU o bullet dos instrumentos e colou
// "não consegui registrar isso agora" num turno que não pedia escrita nenhuma.
//
// 04/09/2026 17:04:19 BRT — mesmo defeito, mesma pessoa: o TOM fez duas perguntas de
// esclarecimento e fechou com "E manda o resto que você ia falar 👀".
//
// O veto contentSolicitation (FATIA 2, 16/08) existe e está ligado nesta porta — a
// ÂNCORA é que é uma lista literal de verbos ("me manda", "pode mandar", "vai listando")
// e não cobre o convite a CONTINUAR, que é como o TOM fala quando alguém dita em partes.

const DUDU_10_09 = `Entendi até aqui:

• 🎸 Instrumentos — tudo organizado
• 🛒 Loja CG — cordas e baquetas pendentes, já agendadas pro dia 21 com Rafinha

Pode continuar, Dudu — manda as próximas coisas!`;

const DUDU_04_09 = `Beleza, Dudu! Das 3 demandas:

• ✅ *Lojinha* — já tá no app com as pendências, confirmado.
• 🥁 *6 baquetas* — pra qual unidade? (Barra, Recreio ou CG?)
• 🎸 *Corda vermelha* — qual unidade e qual sala/guitarra?

E manda o resto que você ia falar 👀`;

// Flags como o engine.js:15160-15181 monta num turno sem marker e sem escrita recente.
const flagsDoTurno = (reply) => ({
  nothingPersisted: true,
  pendingActionRecent: true,
  infoGathering: isContentSolicitationReply(reply),
  contentSolicitation: isContentSolicitationReply(reply),
  markerAttempted: false,
  awaitingConfirm: false,
  userProgressStatus: false,
  restatesRecentWrite: false,
});

test('convite a CONTINUAR é solicitação de conteúdo — o TOM está compondo, não afirmando ação feita', () => {
  assert.strictEqual(isContentSolicitationReply(DUDU_10_09), true, '"Pode continuar — manda as próximas coisas"');
  assert.strictEqual(isContentSolicitationReply(DUDU_04_09), true, '"E manda o resto que você ia falar"');
});

test('o chokepoint não pode apagar bullet nem colar nota de falha em turno de composição', () => {
  for (const [nome, reply] of [['10/09', DUDU_10_09], ['04/09', DUDU_04_09]]) {
    const out = enforceNoMarkerHonesty(reply, flagsDoTurno(reply), { meta: true });
    assert.strictEqual(out.fired, false, `${nome}: o guard disparou num turno que não pedia escrita`);
    assert.strictEqual(out.reply, reply, `${nome}: a resposta foi alterada`);
  }
});

test('CONTROLE (dispara nas duas versões): confab de verdade, sem pedir insumo, segue rebaixado', () => {
  const confab = 'Pronto! ✅ Registrei a tarefa de trocar as cordas pro dia 21.';
  assert.strictEqual(isContentSolicitationReply(confab), false);
  const out = enforceNoMarkerHonesty(confab, flagsDoTurno(confab), { meta: true });
  assert.strictEqual(out.fired, true, 'o guard precisa continuar pegando afirmação falsa');
});

test('CONTROLE: âncora antiga preservada — "me manda" e "pode mandar" seguem vetando', () => {
  assert.strictEqual(isContentSolicitationReply('Me manda o OFX que eu leio.'), true);
  assert.strictEqual(isContentSolicitationReply('Sim! Pode mandar o arquivo que eu registro.'), true);
  assert.strictEqual(isContentSolicitationReply('Vai listando que eu registro.'), true);
});

test('CONTROLE: o alargamento não engole conclusão comum — "continuar" sem convite não casa', () => {
  assert.strictEqual(isContentSolicitationReply('Fechei a tarefa. Ela vai continuar na lista até sexta.'), false);
  assert.strictEqual(isContentSolicitationReply('Mandei o recado pro Rafinha.'), false);
});
