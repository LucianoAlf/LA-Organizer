'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeRescheduleActions, partitionResolved, buildReschedulePreview,
} = require('./reschedule-stage');

// ── Task 2: normalize + partition ─────────────────────────────────────────
test('normalize: alias due_date→new_due_date, remind_at→new_remind_at (engine 3617-3620)', () => {
  const [a] = normalizeRescheduleActions([{ action: 'reschedule', id: 't1', due_date: '2026-07-20' }]);
  assert.strictEqual(a.new_due_date, '2026-07-20');
  const [b] = normalizeRescheduleActions([{ action: 'reschedule', id: 't2', remind_at: '2026-07-20T12:00:00Z' }]);
  assert.strictEqual(b.new_remind_at, '2026-07-20T12:00:00Z');
});
test('normalize: não sobrescreve canônico existente', () => {
  const [a] = normalizeRescheduleActions([{ id: 't1', new_due_date: '2026-07-20', due_date: '2026-01-01' }]);
  assert.strictEqual(a.new_due_date, '2026-07-20');
});
test('partition: caso Matheus — 4 datas válidas → todas resolved', () => {
  const acts = [
    { action: 'reschedule', id: 'clinica', new_due_date: '2026-07-15' },
    { action: 'reschedule', id: 'emusys', new_due_date: '2026-07-15' },
    { action: 'reschedule', id: 'curadoria', new_due_date: '2026-07-20' },
    { action: 'reschedule', id: 'transicao', new_due_date: '2026-07-20' },
  ];
  const { resolved, ambiguous } = partitionResolved(acts);
  assert.strictEqual(resolved.length, 4);
  assert.strictEqual(ambiguous.length, 0);
});
test('partition: PARCIAL — 3 resolvem, 1 sem data → 1 ambíguo com reason (nunca dropa)', () => {
  const acts = [
    { action: 'reschedule', id: 'a', new_due_date: '2026-07-15' },
    { action: 'reschedule', id: 'b', new_due_date: '2026-07-20' },
    { action: 'reschedule', id: 'c', new_due_date: '2026-07-20' },
    { action: 'reschedule', id: 'd' },
  ];
  const { resolved, ambiguous } = partitionResolved(acts);
  assert.strictEqual(resolved.length, 3);
  assert.strictEqual(ambiguous.length, 1);
  assert.strictEqual(ambiguous[0].id, 'd');
  assert.ok(/data/i.test(ambiguous[0].reason));
});
test('partition: data inválida (não-ISO) → ambíguo', () => {
  const { resolved, ambiguous } = partitionResolved([{ id: 'x', new_due_date: 'segunda' }]);
  assert.strictEqual(resolved.length, 0);
  assert.strictEqual(ambiguous.length, 1);
});
test('partition: só new_remind_at (sem due) → resolved', () => {
  const { resolved } = partitionResolved([{ id: 'x', new_remind_at: '2026-07-20T09:00:00Z' }]);
  assert.strictEqual(resolved.length, 1);
});

// ── Task 2b: guarda de data no passado ────────────────────────────────────
test('partition: data no passado vira ambíguo quando todayYmd fornecido', () => {
  const { resolved, ambiguous } = partitionResolved(
    [{ id: 'x', new_due_date: '2026-07-10' }], { todayYmd: '2026-07-15' });
  assert.strictEqual(resolved.length, 0);
  assert.strictEqual(ambiguous.length, 1);
  assert.ok(/passad/i.test(ambiguous[0].reason));
});
test('partition: sem todayYmd não checa passado (retrocompat)', () => {
  const { resolved } = partitionResolved([{ id: 'x', new_due_date: '2020-01-01' }]);
  assert.strictEqual(resolved.length, 1);
});
test('partition: data futura passa mesmo com todayYmd', () => {
  const { resolved } = partitionResolved(
    [{ id: 'x', new_due_date: '2026-07-20' }], { todayYmd: '2026-07-15' });
  assert.strictEqual(resolved.length, 1);
});

// ── Task 3: preview inline engine-generated ───────────────────────────────
test('preview: tudo resolvido → lista + pergunta de confirmação', () => {
  const s = buildReschedulePreview(
    [{ id: 'clinica', new_due_date: '2026-07-15' }, { id: 'curadoria', new_due_date: '2026-07-20' }],
    [], { clinica: 'Atualizar relatórios clínica', curadoria: 'Curadoria professores eMusys' });
  assert.ok(/Atualizar relatórios clínica/.test(s));
  assert.ok(/15\/07/.test(s) && /20\/07/.test(s), 'datas absolutas DD/MM');
  assert.ok(/[Cc]onfirma/.test(s));
});
test('preview: PARCIAL → pergunta a ambígua distinta, sem "Confirma?" cego', () => {
  const s = buildReschedulePreview(
    [{ id: 'a', new_due_date: '2026-07-15' }],
    [{ id: 'd', reason: 'sem data' }], { a: 'Tarefa A', d: 'Tarefa D' });
  assert.ok(/Tarefa A/.test(s) && /15\/07/.test(s));
  assert.ok(/Tarefa D/.test(s), 'a ambígua aparece');
  assert.ok(/[Qq]ual/.test(s), 'pergunta a data da ambígua');
  assert.ok(!/Confirma\?/.test(s), 'sem confirma cego quando há ambígua');
});
test('preview: título ausente cai em fallback com id curto', () => {
  const s = buildReschedulePreview([{ id: 'abcdef123456', new_due_date: '2026-07-15' }], [], {});
  assert.ok(/abcdef12/.test(s));
});
