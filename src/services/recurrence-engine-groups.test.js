const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Mock mínimo: supabase/client não existe localmente (só na VPS).
// buildGroupChildRow é pura — não chama supabase, mas o require do engine puxa o client.
const _origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...args) {
  if (req.includes('supabase/client')) return req;
  return _origResolve.call(this, req, ...args);
};
// recurrence-time e supabase/client podem não existir localmente
Module._load = (function (orig) {
  return function (req, ...args) {
    if (req.includes('supabase/client')) return {};
    if (req.includes('recurrence-time')) return { shiftReminderToInstance: () => {} };
    return orig.call(this, req, ...args);
  };
})(Module._load);

const { buildGroupChildRow } = require('./recurrence-engine');

const childTpl = {
  id: 'tpl-filho-1', title: 'Cartão Barra', context: 'work', status: 'pending',
  due_date: '2026-06-12', due_time: '09:00:00', sort_position: 1,
  parent_task_id: 'tpl-mae', is_group: false,
  recurrence_rule: null, recurrence_parent_id: null, recurrence_excluded: false,
  assigned_to: 'rose', created_by: 'rose', priority: 'medium',
};

test('filha-instância: ponteiros e data do ciclo corretos', () => {
  const row = buildGroupChildRow(childTpl, { id: 'mae-julho', due_date: '2026-07-26' });
  assert.strictEqual(row.due_date, '2026-07-12');
  assert.strictEqual(row.parent_task_id, 'mae-julho');
  assert.strictEqual(row.recurrence_parent_id, 'tpl-filho-1');
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(row.is_group, false);
  assert.strictEqual(row.recurrence_rule, null);
  assert.strictEqual(row.id, undefined);
  assert.strictEqual(row.due_time, '09:00:00');
});

test('clamp: filha dia 31 em ciclo de junho → 30', () => {
  const row = buildGroupChildRow({ ...childTpl, due_date: '2026-05-31' }, { id: 'm', due_date: '2026-06-01' });
  assert.strictEqual(row.due_date, '2026-06-30');
});
