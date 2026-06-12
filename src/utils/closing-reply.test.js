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
