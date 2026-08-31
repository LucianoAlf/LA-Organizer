'use strict';
// PROMISE-NOMARKER-DOWNGRADE (audit 01/07, Reunião Time Gestão ×2) — rodar:
//   node --test src/lib/promise-honesty.test.js
// Buraco: ACTIONABLE_NO_MARKER detecta + auto-retry falha (NO_MARKER), mas a reply visual
// segue intocada ("Não toca na reply visual", Sprint 28.2) → o user recebe a promessa vazia
// do Codex ("Vou criar na agenda e disparar pros 8") como se fosse verdade. O chokepoint não
// pega (gate é verbo de CONCLUSÃO, não promessa futura). Este lib rebaixa: tira a(s) linha(s)
// de promessa (mesma REPLY_PROMISE_RE do engine — uma fonte de verdade) + anexa aviso honesto.
const test = require('node:test');
const assert = require('node:assert');
const { downgradeEmptyPromise, REPLY_PROMISE_RE } = require('./promise-honesty');

const CODEX_REUNIAO =
  'Beleza, Alf — agora sim: sexta 03/07, 9h, *Reunião Time Gestão*.\n' +
  '\n' +
  '📅 *Reunião Time Gestão*\n' +
  '🗓️ Sexta 03/07 · 9h–10h\n' +
  '📋 Pauta: Atividades e Calendário do Segundo Semestre\n' +
  '\n' +
  'Vou criar na agenda e disparar pros 8 confirmarem presença.';

test('caso real (Codex, 01/07): "Vou criar na agenda e disparar pros 8" → rebaixado', () => {
  const r = downgradeEmptyPromise(CODEX_REUNIAO);
  assert.strictEqual(r.fired, true, 'promessa vazia tem que ser rebaixada');
  assert.ok(!/vou criar na agenda/i.test(r.reply), 'a linha da promessa vazia some');
  assert.match(r.reply, /N[ÃA]O foi executad/i, 'entra o aviso honesto');
  assert.match(r.reply, /Beleza, Alf/, 'linha neutra permanece');
});

test('sem promessa → não age (reply intacto)', () => {
  const s = 'Show! A reunião tá marcada lá pra sexta.';
  const r = downgradeEmptyPromise(s);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, s);
});

test('reply 100% promessa vira só o aviso honesto', () => {
  const r = downgradeEmptyPromise('Vou criar a tarefa e te lembro às 9h.');
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /N[ÃA]O foi executad/i);
});

test('CONTROLE: recusa honesta ("não consigo criar por aqui") não dispara', () => {
  const s = 'Não consigo criar isso por aqui — faz pelo app.';
  const r = downgradeEmptyPromise(s);
  assert.strictEqual(r.fired, false, '"criar" bare não é promessa (RE exige "vou criar"/"criando"/"criei")');
});

test('CONTROLE: o próprio disclaimer não re-dispara (idempotente)', () => {
  const once = downgradeEmptyPromise('Vou criar a tarefa agora.');
  const twice = downgradeEmptyPromise(once.reply);
  assert.strictEqual(twice.fired, false, 'rodar 2x não pode duplicar aviso');
});

// CONFAB-INVERSO-OFERTA-CONDICIONAL (Ana Paula, 15/08 22:01 BRT).
// O PREFS_UPDATE dos "domingos silenciosos" executou ok=1 fail=0 às 22:00:58. No turno
// seguinte a Ana só encerrou o assunto ("Caso eu precise eu faço a anotação") e o TOM
// respondeu com uma OFERTA condicional. "registro" casou a REPLY_PROMISE_RE, era a única
// linha, e a resposta inteira virou "essa ação NÃO foi executada" — desmentindo um sucesso.
// Oferta que depende de um pedido FUTURO do user não é promessa deste turno: não há nada
// pra persistir, logo não há vazio a rebaixar.
const ANA_OFERTA = 'Perfeito, Ana! Qualquer coisa que surgir, só manda que eu registro. Bom domingo! ☀️';

test('caso real (Ana, 15/08): oferta condicional não é promessa vazia → não rebaixa', () => {
  const r = downgradeEmptyPromise(ANA_OFERTA);
  assert.strictEqual(r.fired, false, 'oferta condicional não pode ser rebaixada');
  assert.strictEqual(r.reply, ANA_OFERTA, 'reply sai intacta');
});

test('variantes de oferta condicional não disparam', () => {
  for (const s of [
    'Beleza! Se precisar, é só me mandar que eu anoto.',
    'Tranquilo. Quando quiser, me chama que eu registro.',
    'Fechado! Qualquer coisa, só falar que eu adiciono.',
  ]) {
    assert.strictEqual(downgradeEmptyPromise(s).fired, false, s);
  }
});

test('CONTROLE: promessa real + oferta condicional → rebaixa só a promessa', () => {
  const r = downgradeEmptyPromise('Vou criar na agenda pros 8.\nQualquer coisa, só manda que eu registro.');
  assert.strictEqual(r.fired, true, 'a promessa real ainda tem que ser pega');
  assert.ok(!/vou criar na agenda/i.test(r.reply), 'a promessa vazia some');
  assert.match(r.reply, /só manda que eu registro/i, 'a oferta condicional permanece');
});

test('REPLY_PROMISE_RE exportada casa o vocabulário do engine (amostra)', () => {
  for (const s of ['vou criar', 'criando', 'criei', 'reagendei pra sexta', 'marquei para amanhã', 'te lembro às 9h']) {
    assert.ok(REPLY_PROMISE_RE.test(s), s);
  }
});

// PROMISE-DOWNGRADE-COLAPSA-PARAGRAFO (achado bb26cbe6 — Dudu, 27/08 18:51 BRT).
// Literal do banco (marker_logs ACTIONABLE_NO_MARKER 18:51:27, raw_excerpt): o Dudu mandou
// áudio pedindo "guarda isso aí" sobre os cabos XLR e recebeu DUAS notas de erro empilhadas e
// mais NADA — o conteúdo (o que o TOM tinha entendido) sumiu da mensagem entregue.
//
// A raiz não está em nenhum dos dois guards isolados, está no encadeamento. O filtro daqui
// dropava TODA linha em branco, inclusive a que separa o cabeçalho do bloco de bullets. Sem
// esse separador, o `sanitizeOptimisticConfirm` do chokepoint (que roda depois, engine.js
// ~13946, sobre o MESMO reply) lê os bullets como parte do parágrafo da claim e come o bloco
// inteiro. Medido, com e sem a linha em branco: "• Cabos XLR…" vs "" — a diferença é 1 caractere.
const DUDU_CABOS =
  'Entendido, Dudu! Guardando:\n' +
  '\n' +
  '• 🔌 Cabos XLR com defeito + cabo do Vandinho → na sala do Rafinha\n' +
  '• 🔌 Cabo P10 com defeito (encontrado na sala do Rodrigo) → também colocado junto, na sala do Rafinha\n' +
  '\n' +
  'Tá anotado. Continua aí!';

test('caso real (Dudu, 27/08): rebaixar não pode colapsar o parágrafo do conteúdo', () => {
  const r = downgradeEmptyPromise(DUDU_CABOS);
  assert.strictEqual(r.fired, true, 'a promessa vazia ("Tá anotado") tem que ser rebaixada');
  assert.ok(!/tá anotado/i.test(r.reply), 'a linha da promessa vazia some');
  assert.match(r.reply, /Cabos XLR com defeito/, 'o conteúdo entendido permanece');
  assert.match(
    r.reply,
    /Guardando:\n\n• 🔌 Cabos XLR/,
    'a linha em branco ENTRE duas linhas mantidas sobrevive — é ela que impede o chokepoint seguinte de comer os bullets'
  );
});

test('caso real (Dudu, 27/08): a saída rebaixada não é destruída pelo chokepoint seguinte', () => {
  const { sanitizeOptimisticConfirm } = require('./optimistic-confirm');
  const rebaixado = downgradeEmptyPromise(DUDU_CABOS).reply;
  const sobrevive = sanitizeOptimisticConfirm(rebaixado, 'failed');
  assert.match(
    sobrevive,
    /Cabos XLR com defeito/,
    'encadeado com o guard seguinte, o usuário ainda tem que ver o que o TOM entendeu'
  );
});

test('CONTROLE: linha em branco órfã (sobra da promessa removida) continua colapsando', () => {
  const r = downgradeEmptyPromise('Beleza, Alf!\n\nVou criar na agenda pros 8.');
  assert.strictEqual(r.fired, true);
  assert.ok(!/\n\n\n/.test(r.reply), 'não sobra buraco triplo onde a promessa foi removida');
  assert.match(r.reply, /^Beleza, Alf!\n\n_⚠️/, 'a nota honesta encosta direto na linha neutra');
});

// PROMISE-DOWNGRADE-REBAIXA-ADMISSAO (achados ab345c8f / ac7517b8).
// O engine já sabe desde 01/06 que RECUSA não é promessa: `_replyIsDecline` (engine.js ~13543)
// zera `replyHasPromise` quando a reply nega o verbo. Mas aquele flag só governa a MÉTRICA —
// o strip aqui re-testa a RE crua, não enxerga a negação, e apaga a linha assim mesmo. Como
// nesses casos a admissão é a ÚNICA linha, o usuário recebe só o disclaimer genérico: uma
// troca ESTRITAMENTE PIOR, porque a mensagem original já era honesta E trazia os detalhes.
//
// Literais do banco (marker_logs ACTIONABLE_NO_MARKER, raw_excerpt), medidos contra o
// conversation_history: nos dois turnos o outbound entregue foi só o disclaimer.
const RAFINHA_ADMISSAO =
  'Vacilei aqui — não consegui registrar essa mudança de horário do Dudu agora. ' +
  'Me repete: hoje fechamento às 18h30, e toda terça e quinta também às 18h30 — é isso? ' +
  'Me confirma de novo que eu ajusto já.';

test('caso real (Rafinha, 27/08 11:09): admissão de falha não pode ser rebaixada', () => {
  const r = downgradeEmptyPromise(RAFINHA_ADMISSAO);
  assert.strictEqual(r.fired, false, 'quem já admitiu que NÃO registrou não está prometendo nada');
  assert.strictEqual(r.reply, RAFINHA_ADMISSAO, 'a reply sai intacta');
  assert.match(r.reply, /18h30/, 'o horário que o usuário precisa confirmar permanece');
  assert.match(r.reply, /é isso\?/i, 'a re-pergunta permanece — sem ela o fluxo morre');
});

test('variantes de admissão de falha não disparam', () => {
  for (const s of [
    'Pô, tive um problema aqui e não consegui registrar. Pode repetir o pedido?',
    'Não deu pra anotar isso agora — me manda de novo?',
    'Não rolou criar a tarefa aqui, tenta de novo?',
    'Não tenho como registrar isso por aqui.',
  ]) {
    assert.strictEqual(downgradeEmptyPromise(s).fired, false, s);
  }
});

test('CONTROLE: negação de UMA ação não blinda a claim de OUTRA na mesma linha', () => {
  // "não consegui criar o evento" é admissão, mas "já registrei a tarefa" é afirmação de
  // persistência — e nada persistiu. A exceção é por OCORRÊNCIA do verbo, não por linha:
  // blindar a linha inteira aqui deixaria passar exatamente a mentira que o guard existe
  // pra pegar.
  const r = downgradeEmptyPromise('Não consegui criar o evento, mas já registrei a tarefa.');
  assert.strictEqual(r.fired, true, 'a claim não-negada ainda tem que ser pega');
});

test('CONTROLE: promessa real continua sendo rebaixada mesmo com negação em outra frase', () => {
  const r = downgradeEmptyPromise('Não consigo mexer no app. Vou criar na agenda pros 8 confirmarem.');
  assert.strictEqual(r.fired, true, 'a promessa da 2ª frase é vazia e tem que cair');
  assert.ok(!/vou criar na agenda/i.test(r.reply), 'a promessa vazia some');
});
