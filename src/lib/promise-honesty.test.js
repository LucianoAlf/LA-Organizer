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
