'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildClosingItems, parseClosingReply } = require('./closing-reply');

// ---------------------------------------------------------------------------
// buildClosingItems — ordena as tarefas de trabalho na ordem do fechamento
// (atrasadas → com hora → sem hora), numera 1..N e devolve {index,type,id,title}.
// ---------------------------------------------------------------------------
const TODAY = '2026-06-09';

test('buildClosingItems: ordena atrasada → com hora → sem hora e numera', () => {
  const tasks = [
    { id: 'c', title: 'Sem hora', due_date: '2026-06-09', remind_at: null },
    { id: 'b', title: 'Com hora', due_date: '2026-06-09', remind_at: '2026-06-09T13:00:00Z' },
    { id: 'a', title: 'Atrasada', due_date: '2026-06-07', remind_at: null },
  ];
  const items = buildClosingItems(tasks, { today: TODAY });
  assert.deepStrictEqual(items.map((i) => i.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(items.map((i) => i.index), [1, 2, 3]);
  assert.strictEqual(items[0].type, 'task');
  assert.strictEqual(items[0].title, 'Atrasada');
});

test('buildClosingItems: caso Yuri — item 1 = "Lançamentos BG"', () => {
  const tasks = [
    { id: 'bg', title: 'Lançamentos BG', due_date: '2026-06-09', remind_at: null },
    { id: 'x', title: 'Outra', due_date: '2026-06-09', remind_at: null },
  ];
  const items = buildClosingItems(tasks, { today: TODAY });
  assert.strictEqual(items[0].index, 1);
  assert.strictEqual(items[0].id, 'bg');
});

test('buildClosingItems: cap padrão 3', () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, due_date: TODAY }));
  const items = buildClosingItems(tasks, { today: TODAY });
  assert.strictEqual(items.length, 3);
});

test('buildClosingItems: ignora tasks sem id/title e lista vazia', () => {
  assert.deepStrictEqual(buildClosingItems([], { today: TODAY }), []);
  assert.deepStrictEqual(buildClosingItems(null, { today: TODAY }), []);
  const items = buildClosingItems([{ id: null, title: 'x' }, { id: '1', title: '' }, { id: 'ok', title: 'Boa' }], { today: TODAY });
  assert.deepStrictEqual(items.map((i) => i.id), ['ok']);
});

test('buildClosingItems: ordem estável dentro do mesmo bucket (preserva ordem do DB)', () => {
  const tasks = [
    { id: 'a', title: 'A', due_date: TODAY, remind_at: '2026-06-09T12:00:00Z' },
    { id: 'b', title: 'B', due_date: TODAY, remind_at: '2026-06-09T15:00:00Z' },
  ];
  const items = buildClosingItems(tasks, { today: TODAY });
  assert.deepStrictEqual(items.map((i) => i.id), ['a', 'b']);
});

// ---------------------------------------------------------------------------
// parseClosingReply — mapeia a resposta numérica do usuário a status por item.
// 'done' → engine aplica complete; 'progress'/'none' → NÃO conclui.
// ---------------------------------------------------------------------------

test('parseClosingReply: CASO DO BUG — "1 - em andamento" → item 1 NÃO concluído', () => {
  const r = parseClosingReply('1 - em andamento', 2);
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.statuses[0], 'progress');
  assert.strictEqual(r.statuses[1], 'none');
  // ninguém é 'done' → engine não completa nada (nem o item 1, nem alvo concorrente)
  assert.strictEqual(r.statuses.filter((s) => s === 'done').length, 0);
});

test('parseClosingReply: "fiz tudo" → todos done', () => {
  assert.deepStrictEqual(parseClosingReply('fiz tudo', 3).statuses, ['done', 'done', 'done']);
});

test('parseClosingReply: "tudo certo" → todos done', () => {
  assert.deepStrictEqual(parseClosingReply('tudo certo', 2).statuses, ['done', 'done']);
});

// Caso Quintela 18/06 (irmão de CLOSING-INTERCEPTOR-OVERCAPTURE): "fiz tudo" com ressalva
// de futuro/exceção NÃO crava todas done — cai no LLM (matched:false), que entende a nuance.
test('parseClosingReply: "fiz tudo, o de amanhã resolvo amanhã" → NÃO casa (cai no LLM)', () => {
  assert.strictEqual(parseClosingReply('Eu fiz tudo oras.. de hj fiz tudo, o de amanhã resolvo amanhã', 2).matched, false);
});
test('parseClosingReply: "fiz tudo menos a 2" → NÃO casa (exceção → LLM)', () => {
  assert.strictEqual(parseClosingReply('fiz tudo menos a 2', 3).matched, false);
});
test('parseClosingReply: guard não vaza — "fiz tudo" puro e "só a 1" seguem determinísticos', () => {
  assert.deepStrictEqual(parseClosingReply('fiz tudo', 3).statuses, ['done', 'done', 'done']);
  assert.deepStrictEqual(parseClosingReply('só a 1', 3).statuses, ['done', 'none', 'none']);
});

test('parseClosingReply: "só a 1" → 1 done, resto none', () => {
  assert.deepStrictEqual(parseClosingReply('só a 1', 3).statuses, ['done', 'none', 'none']);
});

test('parseClosingReply: "1 e 2" → 1 e 2 done', () => {
  assert.deepStrictEqual(parseClosingReply('1 e 2', 3).statuses, ['done', 'done', 'none']);
});

test('parseClosingReply: "1, 2 e 3" → todos done', () => {
  assert.deepStrictEqual(parseClosingReply('1, 2 e 3', 3).statuses, ['done', 'done', 'done']);
});

test('parseClosingReply: "fiz a 1 e a 3" → 1 e 3 done, 2 none', () => {
  assert.deepStrictEqual(parseClosingReply('fiz a 1 e a 3', 3).statuses, ['done', 'none', 'done']);
});

test('parseClosingReply: status misto "1 em andamento, 2 feito"', () => {
  assert.deepStrictEqual(parseClosingReply('1 em andamento, 2 feito', 2).statuses, ['progress', 'done']);
});

test('parseClosingReply: "fechei a 1 e a 2, a 3 tá em andamento"', () => {
  assert.deepStrictEqual(
    parseClosingReply('fechei a 1 e a 2, a 3 tá em andamento', 3).statuses,
    ['done', 'done', 'progress']
  );
});

test('parseClosingReply: bare "não" → não fez nenhuma (regra BUG-6)', () => {
  const r = parseClosingReply('não', 3);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['none', 'none', 'none']);
});

test('parseClosingReply: "não fiz nada" → todos none', () => {
  const r = parseClosingReply('não fiz nada', 3);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['none', 'none', 'none']);
});

test('parseClosingReply: "1 não fiz" → progress (não conclui)', () => {
  assert.deepStrictEqual(parseClosingReply('1 não fiz', 2).statuses, ['progress', 'none']);
});

test('parseClosingReply: ignora números fora do range', () => {
  // count=2, "fiz a 5" → nenhum número válido → não casa
  const r = parseClosingReply('fiz a 5', 2);
  assert.strictEqual(r.matched, false);
});

test('parseClosingReply: texto não-fechamento não casa', () => {
  assert.strictEqual(parseClosingReply('saldo do nubank', 3).matched, false);
  assert.strictEqual(parseClosingReply('manda ver', 3).matched, false);
  assert.strictEqual(parseClosingReply('ok', 3).matched, false);
});

test('parseClosingReply: defensivo — count 0, texto vazio, texto longo', () => {
  assert.strictEqual(parseClosingReply('1', 0).matched, false);
  assert.strictEqual(parseClosingReply('', 3).matched, false);
  assert.strictEqual(parseClosingReply('1 '.repeat(150), 3).matched, false);
  assert.strictEqual(parseClosingReply(null, 3).matched, false);
});

// ---------------------------------------------------------------------------
// CLOSING-INTERCEPTOR-OVERCAPTURE (audit 15/06 — Lote A)
// ---------------------------------------------------------------------------

// Task 1: rule #4 estreitada — frase LONGA iniciada por "não" NÃO casa (caso Ana/ADM).
// Antes `^não\b` capturava qualquer frase começando com "não" → "não fiz nenhuma".
test('parseClosingReply: "não foi a ADM, foi a de hoje" NÃO casa (rule #4 estreitada)', () => {
  assert.strictEqual(parseClosingReply('não foi a ADM, foi a de hoje', 3).matched, false);
});
test('parseClosingReply: "nada." (pontuação à direita) ainda casa como nenhuma', () => {
  const r = parseClosingReply('nada.', 2);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['none', 'none']);
});

// Task 2: shouldClosingInterceptorFire — gate de sobre-captura do interceptor de fechamento.
const { shouldClosingInterceptorFire } = require('./closing-reply');
const NOW_FIRE = new Date('2026-06-15T18:00:00Z'); // 15:00 BRT
const mkClosing = (askedAt) => ({
  id: 'c1', kind: 'confirmation', asked_at: askedAt,
  payload: { closing: { items: [
    { index: 1, type: 'task', id: 't1', title: 'Lançamentos BG' },
    { index: 2, type: 'task', id: 't2', title: 'Editar vídeo Copa' },
  ] } },
});

test('shouldClosingInterceptorFire: fechamento de HOJE, sem quote/fresher → fire (Yuri+)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    openIntents: [], replyParsed: { userText: '1 - em andamento' }, now: NOW_FIRE });
  assert.strictEqual(r.fire, true);
});
test('shouldClosingInterceptorFire: fechamento de ONTEM 23h → not_today (Fabi overnight)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-14T23:00:00Z'), now: NOW_FIRE });
  assert.deepStrictEqual([r.fire, r.reason], [false, 'not_today']);
});
test('shouldClosingInterceptorFire: reply-quote a menu de duplicata → reply_quote_elsewhere (Juliana)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    replyParsed: { userText: '2', quotedText: 'Qual desses? 1) Reunião ADM 2) Reunião DM' }, now: NOW_FIRE });
  assert.deepStrictEqual([r.fire, r.reason], [false, 'reply_quote_elsewhere']);
});
test('shouldClosingInterceptorFire: reply-quote AO PRÓPRIO fechamento → fire (caso 7 positivo)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    replyParsed: { userText: '1,2', quotedText: 'Fechamento de hoje: 1) Lançamentos BG 2) Editar vídeo Copa' }, now: NOW_FIRE });
  assert.strictEqual(r.fire, true);
});
test('shouldClosingInterceptorFire: intent mais fresca aberta → fresher_intent', () => {
  const c = mkClosing('2026-06-15T11:00:00Z');
  const r = shouldClosingInterceptorFire({ closingIntent: c,
    openIntents: [c, { id: 'i2', asked_at: '2026-06-15T17:00:00Z' }], now: NOW_FIRE });
  assert.deepStrictEqual([r.fire, r.reason], [false, 'fresher_intent']);
});
test('shouldClosingInterceptorFire: sem candidato / payload inválido → no_closing', () => {
  assert.strictEqual(shouldClosingInterceptorFire({ closingIntent: null }).fire, false);
  assert.strictEqual(shouldClosingInterceptorFire({ closingIntent: { payload: {} } }).reason, 'no_closing');
});

// Task 4 (A2): batchCompleteNeedsConfirm — complete em LOTE não citado → confirmar antes.
const { batchCompleteNeedsConfirm } = require('./closing-reply');

test('batchCompleteNeedsConfirm: 2+ tarefas NÃO citadas → true (caso Leo)', () => {
  assert.strictEqual(batchCompleteNeedsConfirm({
    completedTitles: ['Definir repertório do show', 'Alinhar com produção'],
    inboundText: 'criar 2 eventos pedagógicos pra semana que vem' }), true);
});
test('batchCompleteNeedsConfirm: usuário citou as tarefas → false (legítimo)', () => {
  assert.strictEqual(batchCompleteNeedsConfirm({
    completedTitles: ['Repertório do show', 'Produção do evento'],
    inboundText: 'fechei o repertório e a produção' }), false);
});
test('batchCompleteNeedsConfirm: 1 tarefa só → false (não é lote)', () => {
  assert.strictEqual(batchCompleteNeedsConfirm({ completedTitles: ['Qualquer coisa'], inboundText: 'xpto' }), false);
});
test('batchCompleteNeedsConfirm: inbound vazio + lote → true (defensivo)', () => {
  assert.strictEqual(batchCompleteNeedsConfirm({ completedTitles: ['A B C', 'D E F'], inboundText: '' }), true);
});

// ---------------------------------------------------------------------------
// futureDoneItems — guarda (b): dos items 'done', separa os de due FUTURA p/ o
// interceptor NÃO fechar tarefa de amanhã no fechamento de hoje (caso Quintela).
// ---------------------------------------------------------------------------
const { futureDoneItems } = require('./closing-reply');
const ITEMS = [
  { index: 1, type: 'task', id: 'a', title: 'Hoje' },
  { index: 2, type: 'task', id: 'b', title: 'Amanhã' },
];

test('futureDoneItems: done com due futura é separado; due hoje/passado não', () => {
  const out = futureDoneItems(ITEMS, ['done', 'done'], { a: '2026-06-18', b: '2026-06-19' }, '2026-06-18');
  assert.deepStrictEqual(out.map((i) => i.id), ['b']);
});
test('futureDoneItems: só considera done (progress/none ignorados)', () => {
  assert.deepStrictEqual(futureDoneItems(ITEMS, ['progress', 'none'], { a: '2026-06-19', b: '2026-06-19' }, '2026-06-18'), []);
});
test('futureDoneItems: sem due_date não é futura (fecha normal)', () => {
  assert.deepStrictEqual(futureDoneItems([{ index: 1, type: 'task', id: 'a', title: 'x' }], ['done'], { a: null }, '2026-06-18'), []);
});
test('futureDoneItems: due com timestamp futuro também separa', () => {
  const out = futureDoneItems([{ index: 1, type: 'task', id: 'a', title: 'x' }], ['done'], { a: '2026-06-20T13:00:00Z' }, '2026-06-18');
  assert.deepStrictEqual(out.map((i) => i.id), ['a']);
});

// ── CLOSING-CANCEL-IGNORED (Yuri 01/07) ─────────────────────────────────────
test('Yuri: "1 SIM 2 SIM 3 NÃO pode cancelar" → done, done, CANCEL (não progress)', () => {
  const r = parseClosingReply('1 SIM\n2 SIM\n3 NÃO pode cancelar', 3);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['done', 'done', 'cancel']);
});

test('cancel direto: "3 cancela" → cancel', () => {
  const r = parseClosingReply('1 e 2 feitas, 3 cancela', 3);
  assert.deepStrictEqual(r.statuses, ['done', 'done', 'cancel']);
});

test('CONTROLE: "3 não fiz" segue progress (sem cancelar nada)', () => {
  const r = parseClosingReply('1 sim, 3 não fiz', 3);
  assert.deepStrictEqual(r.statuses, ['done', 'none', 'progress']);
});

test('CONTROLE: "pode cancelar tudo" sem número NÃO casa (cai no LLM, fail-safe)', () => {
  const r = parseClosingReply('pode cancelar tudo', 3);
  assert.strictEqual(r.matched, false);
});

// ── CLOSING-PARTIAL-TOPICS-DONE (Quintela 06/07) ────────────────────────────
test('Quintela: "3. Feito alguns topicos da tarefa" → progress (NÃO fecha item parcial)', () => {
  const r = parseClosingReply('3. Feito alguns topicos da tarefa', 3);
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.statuses[2], 'progress', 'conclusão parcial não pode virar done');
});
test('parcialidade: "1 feito, 2 fiz parte" → done, progress', () => {
  assert.deepStrictEqual(parseClosingReply('1 feito, 2 fiz parte', 2).statuses, ['done', 'progress']);
});
test('CONTROLE: "1 e 2 feito, 3 feito" segue tudo done (sem sinal de parcialidade)', () => {
  assert.deepStrictEqual(parseClosingReply('1 e 2 feito, 3 feito', 3).statuses, ['done', 'done', 'done']);
});
test('CONTROLE: "fiz tudo" puro segue done global', () => {
  assert.deepStrictEqual(parseClosingReply('fiz tudo', 3).statuses, ['done', 'done', 'done']);
});

// ── CLOSING-ANNOTATED-DEFAULT-DONE (Quintela 08/07) ─────────────────────────
// 3ª semana da MESMA família (cancel 02/07, parcial 07/07, reschedule 08/07): o default
// do segmento anotado era 'done' — qualquer verbo não-previsto fechava o item. Política
// INVERTIDA: anotação que não casa NENHUM sinal conhecido → matched:false (LLM decide
// com o contexto). Menção nua ("1 e 2") segue done — é o formato pedido pelo ritual.

test('Quintela 08/07 REAL: "1. Remarcar para sábado..." → matched:false (LLM)', () => {
  const raw = '1. Remarcar para sábado \n2. ⁠processo postergado até sexta 17/07\n3. ⁠feito\n4. ⁠feito';
  const r = parseClosingReply(raw, 3);
  assert.strictEqual(r.matched, false, 'reschedule/postergação não pode virar done');
});

test('reschedule isolado: "1 remarquei pra sábado" → matched:false', () => {
  assert.strictEqual(parseClosingReply('1 remarquei pra sábado', 2).matched, false);
});

test('postergação isolada: "2 postergado até sexta" → matched:false', () => {
  assert.strictEqual(parseClosingReply('2 postergado até sexta', 3).matched, false);
});

test('anotação aleatória: "1 comprei o material" → matched:false (antes: done errado)', () => {
  assert.strictEqual(parseClosingReply('1 comprei o material', 2).matched, false);
});

test('word joiner do WhatsApp: "3. \\u2060feito" segue done', () => {
  const r = parseClosingReply('3. ⁠feito', 3);
  assert.strictEqual(r.matched, true);
  assert.strictEqual(r.statuses[2], 'done');
});

test('CONTROLE pós-inversão: "1 SIM" e "2 ok" seguem done (afirmação explícita)', () => {
  assert.deepStrictEqual(parseClosingReply('1 sim, 2 ok', 2).statuses, ['done', 'done']);
});

// ── CLOSING-FRESHER-OUTBOUND-BIND (Quintela 08/07, parte B) ─────────────────
// Entre o fechamento (19:04, lista de 3) e a resposta (19:20) o TOM mandou o BALANÇO de
// aderência (19:19, lista de 4 SEM número). A resposta numerada era pro balanço, mas o
// interceptor mapeou na lista do fechamento. Gate novo: última outbound mais fresca que a
// pergunta (+90s de tolerância pra própria pergunta do ritual) → fail-safe LLM.

test('fresher_outbound: TOM mandou outra msg depois do fechamento → NÃO captura', () => {
  const r = shouldClosingInterceptorFire({
    closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    openIntents: [], replyParsed: { userText: '1. remarcar\n2. feito' },
    now: NOW_FIRE, lastOutboundAt: '2026-06-15T11:15:00Z',
  });
  assert.deepStrictEqual([r.fire, r.reason], [false, 'fresher_outbound']);
});

test('fresher_outbound: outbound é a PRÓPRIA pergunta (segundos depois) → captura normal', () => {
  const r = shouldClosingInterceptorFire({
    closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    openIntents: [], replyParsed: { userText: '1 e 2' },
    now: NOW_FIRE, lastOutboundAt: '2026-06-15T11:00:30Z',
  });
  assert.strictEqual(r.fire, true);
});

test('fresher_outbound: sem lastOutboundAt (null/ausente/inválido) → comportamento atual', () => {
  const base = { closingIntent: mkClosing('2026-06-15T11:00:00Z'), openIntents: [], replyParsed: { userText: '1' }, now: NOW_FIRE };
  assert.strictEqual(shouldClosingInterceptorFire({ ...base }).fire, true);
  assert.strictEqual(shouldClosingInterceptorFire({ ...base, lastOutboundAt: null }).fire, true);
  assert.strictEqual(shouldClosingInterceptorFire({ ...base, lastOutboundAt: 'lixo' }).fire, true);
});

// ── CLOSING-SEGMENT-ORPHAN-BLEED (Yuri 10/07) ───────────────────────────────
// O segmento do ÚLTIMO número ia até o fim da string e ENGOLIA uma LINHA ÓRFÃ de outro
// assunto ("3 - Sim\n\nrec Kaio NÃO foi possivel") — o "não" da órfã fazia o item 3 (Sim)
// virar progress em vez de done. Corte na quebra de PARÁGRAFO (\n\n = mudança de assunto).
test('Yuri 10/07 REAL: linha órfã "rec Kaio não..." após \\n\\n NÃO contamina o item 3 (Sim=done)', () => {
  const raw = '1 não, reagendei \n2 - não, um pouco por vez\n3 - Sim\n\nrec Kaio não foi possivel reagendei tb';
  assert.deepStrictEqual(parseClosingReply(raw, 3).statuses, ['progress', 'progress', 'done']);
});
test('órfã com "não" após \\n\\n não rebaixa o último item', () => {
  assert.deepStrictEqual(parseClosingReply('1 feito\n\nobs: não deu tempo do resto', 1).statuses, ['done']);
});
test('CONTROLE: sem \\n\\n nada muda — "1 feito, 2 feito, 3 em andamento"', () => {
  assert.deepStrictEqual(parseClosingReply('1 feito, 2 feito, 3 em andamento', 3).statuses, ['done', 'done', 'progress']);
});

// BATCH-CONFIRM-DUP-TITLES (caso Arthur 01/08) — a lista de confirmação repetia o mesmo
// título N vezes (instâncias diárias da recorrência), e o Arthur não tinha como saber o que
// estava confirmando: "*Mensagem de feliz aniversário*, *Verificar presenças do dia anterior*,
// *Mensagem de aniversário*, *Verificar presenças do dia anterior*, ...".
const { formatBatchTitles } = require('./closing-reply');

test('agrupa títulos repetidos com contagem (caso Arthur)', () => {
  const real = ['Mensagem de feliz aniversário', 'Verificar presenças do dia anterior',
    'Mensagem de aniversário', 'Verificar presenças do dia anterior',
    'Mensagem de feliz aniversário', 'Verificar presenças do dia anterior'];
  assert.strictEqual(formatBatchTitles(real),
    '*Mensagem de feliz aniversário* (2×), *Verificar presenças do dia anterior* (3×), *Mensagem de aniversário*');
});

test('títulos únicos ficam iguais (sem contagem)', () => {
  assert.strictEqual(formatBatchTitles(['Pagar contas', 'Ligar pro fornecedor']),
    '*Pagar contas*, *Ligar pro fornecedor*');
});

test('preserva ordem de primeira aparição e ignora vazios', () => {
  assert.strictEqual(formatBatchTitles(['B', '', 'A', 'B', null]), '*B* (2×), *A*');
});

// ---------------------------------------------------------------------------
// CLOSING-AFIRMATIVA-NAO-OUVIDA (sonda 07/09) — o ritual de fechamento PEDE, com
// estas palavras, «fez? Me diz: "sim" ou "não rolou"» — e o parser recusava "sim".
// Só "tudo/todas" e a resposta numerada fechavam. Medido no banco de produção:
// 61 fechamentos receberam resposta em até 20 min desde julho; 11 fecharam e
// 9 eram um sim inequívoco que caía no LLM — e em 7 desses 9 a intent terminou
// 'superseded', que é a assinatura do "TOM repetiu a confirmação" (os achados
// 07d42c92 e 688dc7e6 de julho, ainda abertos).
//
// As falas abaixo são LITERAIS do banco. A regra nova é ÚLTIMO RECURSO: só roda
// depois de tudo o que já existia dar matched:false, então nenhum resultado atual
// muda de valor — é zero-regressão por construção.
// ---------------------------------------------------------------------------

// Um item: não há alvo ambíguo possível. Qualquer afirmativa fecha.
for (const fala of ['sim', 'Sim', 'Sim rolou', 'fiz', 'Fiz', 'feito', 'Feito', 'ok', 'Confirmado']) {
  test(`parseClosingReply: 1 item — "${fala}" fecha (a palavra que o ritual pede)`, () => {
    const r = parseClosingReply(fala, 1);
    assert.strictEqual(r.matched, true, `"${fala}" deveria casar`);
    assert.deepStrictEqual(r.statuses, ['done']);
  });
}

test('parseClosingReply: 1 item — "Já fiz, tom, pode tirar" fecha (fala real, 07/2026)', () => {
  const r = parseClosingReply('Já fiz, tom, pode tirar', 1);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['done']);
});

test('parseClosingReply: 1 item — "Tudo finalizado" fecha (ordem invertida não casava o global)', () => {
  const r = parseClosingReply('Tudo finalizado', 1);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['done']);
});

// LIMITE CONHECIDO E ACEITO. Esta fala é real (08/2026) e é uma confirmação legítima,
// mas o PROGRESS_RE casa "andando" DENTRO de "mandando" (a alternativa não tem \b) e veta.
// Deixo documentado em vez de afrouxar o PROGRESS_RE: ele guarda a família de parcialidade
// (CLOSING-PARTIAL-TOPICS-DONE) e mexer nele mudaria vereditos que já existem no caminho
// numerado — o oposto do zero-regressão que esta mudança promete. O custo é fail-safe:
// a mensagem cai no LLM, que tem as âncoras no prompt. O ganho de forçar aqui seria fechar
// tarefa por conta própria, que é a dor #1.
test('parseClosingReply: afirmativa com palavra que o PROGRESS_RE veta cai no LLM (fail-safe)', () => {
  const r = parseClosingReply('Fiz, Tom! Terminei. Segunda to mandando pra gráfica', 1);
  assert.strictEqual(r.matched, false);
  assert.deepStrictEqual(r.statuses, ['none']);
});

// Vários itens: só fecha tudo quem disse EXPLICITAMENTE que é tudo.
test('parseClosingReply: 3 itens — "Sim para tds" fecha os três (fala real, 07/2026)', () => {
  const r = parseClosingReply('Sim para tds', 3);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['done', 'done', 'done']);
});

test('parseClosingReply: 3 itens — "Sim para todas" fecha os três', () => {
  const r = parseClosingReply('Sim para todas', 3);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['done', 'done', 'done']);
});

test('parseClosingReply: 3 itens — "Sim" pelado NÃO fecha (qual dos três?) → cai no LLM', () => {
  const r = parseClosingReply('Sim', 3);
  assert.strictEqual(r.matched, false);
  assert.deepStrictEqual(r.statuses, ['none', 'none', 'none']);
});

test('parseClosingReply: 3 itens — menção por TÍTULO não fecha em lote (outra família)', () => {
  const r = parseClosingReply('Falar com William - Feito', 3);
  assert.strictEqual(r.matched, false);
});

// Vetos: a regra nova NUNCA pode atropelar parcialidade nem pedido de outra ação.
test('parseClosingReply: "feito pela metade" NÃO fecha (parcialidade vence a afirmativa)', () => {
  const r = parseClosingReply('feito pela metade', 1);
  assert.strictEqual(r.matched, false);
});

test('parseClosingReply: "feito só uma parte" NÃO fecha', () => {
  const r = parseClosingReply('feito só uma parte', 1);
  assert.strictEqual(r.matched, false);
});

test('parseClosingReply: "pode cancelar" NÃO fecha (pedido de outra ação)', () => {
  const r = parseClosingReply('pode cancelar', 1);
  assert.strictEqual(r.matched, false);
});

test('parseClosingReply: "ainda não" NÃO fecha', () => {
  const r = parseClosingReply('ainda não', 1);
  assert.notStrictEqual(r.statuses[0], 'done');
});

// Zero-regressão: o que já funcionava continua idêntico.
test('parseClosingReply: zero-regressão — numerada, globais e negação intactas', () => {
  assert.deepStrictEqual(parseClosingReply('1 e 2', 3).statuses, ['done', 'done', 'none']);
  assert.deepStrictEqual(parseClosingReply('fiz tudo', 3).statuses, ['done', 'done', 'done']);
  assert.strictEqual(parseClosingReply('não', 3).matched, true);
  assert.deepStrictEqual(parseClosingReply('não', 3).statuses, ['none', 'none', 'none']);
  // ALIGN (tudo COM ressalva) segue caindo no LLM
  assert.strictEqual(parseClosingReply('fiz tudo menos a 2', 3).matched, false);
});

// ---------------------------------------------------------------------------
// PERGUNTA-VIRA-BAIXA (medido 07/09, no MESMO dia em que a regra de último recurso
// entrou — achado pela sonda rodando sobre o acervo aberto inteiro).
//
// O detectUserConfirmation abre com STRONG_YES_OPEN: qualquer frase começada por
// "isso/sim/claro", sem ressalva, volta 'yes' — inclusive uma PERGUNTA. A fala abaixo
// é real (achado edba1c46, 20/06) e virava ["done"] com 1 item.
//
// No caminho ANCORADO o confirmationBindOk já barrava (frase-longa que não cita a
// âncora não amarra). O caminho do fechamento não passa por aquele portão, então a
// trava mora aqui e espelha a MESMA regra: ≤4 palavras é genérico e vale; frase-longa
// só confirma com sinal explícito de conclusão ou marcador global; e pergunta nunca
// confirma. Restringir a regra nova só devolve casos ao comportamento anterior.
// ---------------------------------------------------------------------------
test('parseClosingReply: PERGUNTA não dá baixa (fala real do achado edba1c46)', () => {
  const r = parseClosingReply('isso era pra mim mesmo? 🤔', 1);
  assert.strictEqual(r.matched, false);
  assert.deepStrictEqual(r.statuses, ['none']);
});

for (const pergunta of ['isso aqui era pra mim?', 'era essa mesmo que você queria?', 'ok?', 'sim?']) {
  test(`parseClosingReply: "${pergunta}" é pergunta, não confirmação`, () => {
    assert.strictEqual(parseClosingReply(pergunta, 1).matched, false);
  });
}

test('parseClosingReply: frase-longa SEM sinal de conclusão não fecha', () => {
  // 6 palavras, começa com afirmador, mas não diz que fez nada.
  assert.strictEqual(parseClosingReply('isso mesmo que eu tava pensando', 1).matched, false);
});

test('parseClosingReply: frase-longa COM sinal de conclusão continua fechando', () => {
  // A trava não pode comer a confirmação legítima longa (fala real, 07/2026).
  const r = parseClosingReply('Já fiz, tom, pode tirar', 1);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['done']);
});

test('parseClosingReply: a trava não mexe nas afirmativas curtas', () => {
  for (const f of ['sim', 'Sim rolou', 'feito', 'ok', 'Tudo finalizado']) {
    assert.strictEqual(parseClosingReply(f, 1).matched, true, `"${f}" deveria seguir fechando`);
  }
});
