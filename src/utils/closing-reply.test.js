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
