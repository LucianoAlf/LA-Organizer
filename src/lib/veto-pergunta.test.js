'use strict';
// veto-pergunta.test.js — UMA régua de "é pergunta, não acusa" para as DUAS portas (03/10/2026).
//   node --test src/lib/veto-pergunta.test.js
//
// A 3ª porta da oferta condicional (16/08, 31/08, 02/10). A de BAIXO (enforceNoMarkerHonesty)
// já não acusava pergunta nem turno em awaitingConfirm; a de CIMA (downgradeEmptyPromise) não
// tinha esses vetos, e apagava o pedido de confirmação + colava "Me diz de novo o que você quer
// que eu faça" — mandando a pessoa se repetir logo depois de o TOM perguntar. Os textos abaixo
// são os `raw_excerpt` REAIS (marker_logs, CHOKEPOINT confab:promise_nomarker), byte a byte.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  downgradeEmptyPromise, decidirPromessaSemMarcador,
  PROMISE_NOMARKER_DISCLAIMER, PROMISE_FALHOU_DISCLAIMER,
  PROMISE_PERGUNTA_DISCLAIMER, PROMISE_PERGUNTA_FALHOU_DISCLAIMER,
} = require('./promise-honesty');
const { vetoDePergunta, fraseEhPedidoDeConfirmacao, textoTemPergunta } = require('./veto-pergunta');
const { hasCompletionClaim, hasWeakCompletionClaim, hasStateAssertionClaim } = require('./optimistic-confirm');

// Rafinha 02/10 19:21:23 UTC — pedido de confirmação com oferta condicional. O guard ERROU.
const RAFINHA_0210 = 'Fechou, ajusto o valor pra *R$156,00* 👍. Só falta confirmar o item: o piano com defeito é o *Piano Casio Privia PX-160 — Sala 8 Teclas · Campo Grande* (id 132)? Confirma esse que eu registro o defeito nele e já lanço a compra da manta no financeiro.';

// Rafinha 01/10 16:25:07 UTC — "anotei mais esses 2" era FALSO (nada persistiu), mas o resto
// são perguntas. O guard ACERTOU em agir; errou em mandar ela repetir tudo.
const RAFINHA_0110 = 'Beleza, anotei mais esses 2 — já são 5 no total. Mas ainda preciso das mesmas infos pra criar todos (incluindo os 3 anteriores):\n\n• Horário de cada um\n• Presencial (qual local?) ou online?\n• Entram como "show" ou "la_music"?\n\nE sobre o dia 9/10 em Campo Grande — qual o nome/tipo desse evento? Só veio "evento campo grande", preciso de um título.';

// Rafinha 17/09 23:01:08 UTC — mesma família do 02/10, com "Confirma que crio".
const RAFINHA_1709 = 'Entendi do áudio, Rafinha — 4 demandas pra amanhã (18/09):\n\n• Trocar lâmpada do *bistrô*\n• Trocar iluminação da *recepção*\n• Colocar o *xerim* pra funcionar na tomada\n• Trocar lâmpada do *corredor do estúdio*\n\nÉ na unidade *Campo Grande*? Confirma que crio as 4 já com prazo amanhã.';

// Dudu 27/08 21:52:36 UTC — afirmação falsa SEM pergunta: tem que seguir caindo como sempre.
const DUDU_2708 = 'Anotado, Dudu! 🔋 Baterias 9V: *10 no total* (não 9).';

test('(a) Rafinha 02/10: pedido de confirmação com oferta condicional fica INTOCADO', () => {
  const r = decidirPromessaSemMarcador(RAFINHA_0210, {});
  assert.strictEqual(r.fired, false, 'pedir confirmação não é prometer');
  assert.strictEqual(r.reply, RAFINHA_0210);
  assert.strictEqual(r.veto, 'pergunta');
  // o wrapper antigo, que o engine e os testes antigos usam, decide igual
  assert.strictEqual(downgradeEmptyPromise(RAFINHA_0210).fired, false);
});

test('(a) Rafinha 17/09: "Confirma que crio as 4" é a mesma família — intocado', () => {
  const r = decidirPromessaSemMarcador(RAFINHA_1709, {});
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, RAFINHA_1709);
});

test('(b) Rafinha 01/10: sai a afirmação falsa, ficam as perguntas, e NÃO manda repetir', () => {
  const r = decidirPromessaSemMarcador(RAFINHA_0110, {});
  assert.strictEqual(r.fired, true, 'o "anotei mais esses 2" era falso — o guard tem que agir');
  assert.strictEqual(r.modo, 'neutraliza');
  const esperado = 'Mas ainda preciso das mesmas infos pra criar todos (incluindo os 3 anteriores):\n\n• Horário de cada um\n• Presencial (qual local?) ou online?\n• Entram como "show" ou "la_music"?\n\nE sobre o dia 9/10 em Campo Grande — qual o nome/tipo desse evento? Só veio "evento campo grande", preciso de um título.\n\n' + PROMISE_PERGUNTA_DISCLAIMER;
  assert.strictEqual(r.reply, esperado);
  assert.ok(!/anotei mais esses 2/.test(r.reply), 'a afirmação falsa sai');
  assert.ok(!/Me diz de novo/.test(r.reply), 'a pessoa NÃO é mandada se repetir depois de uma pergunta');
});

test('(b) com marcador tentado e rejeitado: nota técnica, também sem mandar repetir', () => {
  const r = decidirPromessaSemMarcador(RAFINHA_0110, { markerAttempted: true });
  assert.strictEqual(r.fired, true);
  assert.ok(r.reply.endsWith(PROMISE_PERGUNTA_FALHOU_DISCLAIMER));
  assert.ok(!/Me (?:diz|pede) de novo/.test(r.reply));
});

test('(c) Dudu 27/08: afirmação falsa sem pergunta — comportamento de hoje, byte a byte', () => {
  const r = decidirPromessaSemMarcador(DUDU_2708, {});
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.modo, 'rebaixa');
  assert.strictEqual(r.reply, '🔋 Baterias 9V: *10 no total* (não 9).\n\n' + PROMISE_NOMARKER_DISCLAIMER);
  assert.strictEqual(decidirPromessaSemMarcador(DUDU_2708, { markerAttempted: true }).reply, '🔋 Baterias 9V: *10 no total* (não 9).\n\n' + PROMISE_FALHOU_DISCLAIMER);
});

test('(c) a pergunta que É a afirmação não protege: "Registrei tudo, certo?" segue caindo', () => {
  // Bianca 09/08: perguntar-e-afirmar no mesmo sopro é padrão do TOM. A pergunta não torna o
  // "registrei" verdadeiro — e sem outra pergunta sobrando, a nota é a de sempre.
  const r = decidirPromessaSemMarcador('Registrei tudo, certo?', {});
  assert.strictEqual(r.fired, true);
  assert.strictEqual(r.reply, PROMISE_NOMARKER_DISCLAIMER);
});

test('awaitingConfirm veta a porta de cima como já vetava a de baixo', () => {
  const r = decidirPromessaSemMarcador(DUDU_2708, { awaitingConfirm: true });
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.veto, 'awaiting_confirm');
  assert.strictEqual(r.reply, DUDU_2708);
});

test('pedido de confirmação: o que é e o que não é', () => {
  for (const f of [
    'Confirma esse que eu registro o defeito nele e já lanço a compra da manta no financeiro.',
    'Confirma que crio as 4 já com prazo amanhã.',
    'Me confirma de novo que eu ajusto já.',
    'Só me confirma e eu registro.',
    'Registro como pessoal ou trabalho?',
    'Posso anotar assim?',
  ]) assert.strictEqual(fraseEhPedidoDeConfirmacao(f), true, `é pedido: ${f}`);
  for (const f of [
    'Registrei tudo, certo?',
    'Tá anotado, beleza?',
    'Confirmado! Registrei o pedido.',
    'Anotei os 3 itens.',
    'Vou criar a tarefa amanhã.',
    'Confirma pra mim: anotei 3 itens.',
  ]) assert.strictEqual(fraseEhPedidoDeConfirmacao(f), false, `NÃO é pedido: ${f}`);
});

test('textoTemPergunta enxerga pergunta no meio e pedido sem "?"', () => {
  assert.strictEqual(textoTemPergunta('Qual o horário? Só veio isso.'), true);
  assert.strictEqual(textoTemPergunta('Confirma que eu crio.'), true);
  assert.strictEqual(textoTemPergunta('Tudo certo por aqui.'), false);
});

test('porta de baixo usa a MESMA régua: claim que é pergunta é vetado, claim afirmado não', () => {
  const acusaEmBaixo = (f) => !!(hasCompletionClaim(f) || hasWeakCompletionClaim(f));
  // Hugo 25/09 — já vetado pela pergunta-nao-e-afirmacao; a régua nova concorda.
  assert.strictEqual(vetoDePergunta('Salvo como *LA Performance Report* ou como link do *Organizer*?', { ehAcusada: acusaEmBaixo }).veto, true);
  // Bianca 09/08 — a afirmação mora em outra linha; tem que continuar acusando.
  assert.strictEqual(vetoDePergunta('Entendi: quer tirar o lembrete, certo?\n✅ Lembrete removido', { ehAcusada: acusaEmBaixo }).veto, false);
  assert.strictEqual(vetoDePergunta('qualquer coisa', { awaitingConfirm: true, ehAcusada: acusaEmBaixo }).veto, true);
});

test('as notas novas não viram acusação na porta de baixo (que roda DEPOIS sobre o texto já reescrito)', () => {
  for (const n of [PROMISE_PERGUNTA_DISCLAIMER, PROMISE_PERGUNTA_FALHOU_DISCLAIMER]) {
    assert.strictEqual(hasCompletionClaim(n), false, n);
    assert.strictEqual(hasWeakCompletionClaim(n), false, n);
    assert.strictEqual(hasStateAssertionClaim(n), false, n);
    assert.ok(!/Me (?:diz|pede) de novo/.test(n), n);
  }
});

test('engine: as DUAS portas consultam a mesma régua', () => {
  const ENG = require('fs').readFileSync(require('path').join(__dirname, '..', 'engine.js'), 'utf8');
  assert.ok(ENG.includes("require('./lib/veto-pergunta')"), 'a régua tem que estar importada no engine');
  assert.ok(ENG.includes('awaitingConfirm: !!_metrics.awaiting_user_confirm });'), 'porta de cima recebe awaitingConfirm');
  assert.ok(ENG.includes('|| vetoDePergunta(reply, { ehAcusada: (f) => !!(hasCompletionClaim(f) || hasWeakCompletionClaim(f)) }).veto'), 'porta de baixo usa a régua');
  assert.ok(ENG.includes("'confab:promise_nomarker_pergunta'"), 'neutralização loga motivo próprio');
});
