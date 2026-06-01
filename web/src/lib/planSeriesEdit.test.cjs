const { test } = require('node:test');
const assert = require('node:assert');
const { planSeriesEdit } = require('./planSeriesEdit.cjs');

const TODAY = '2026-06-10';
const anchorTemplate = { id: 'tpl', recurrence_parent_id: null, due_date: '2026-06-10' };
const anchorInstance = { id: 'inst', recurrence_parent_id: 'tpl', due_date: '2026-06-12' };

test('this_and_future com regra nova: cancela futuras e re-materializa', () => {
  const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: 'FREQ=DAILY', todayYmd: TODAY });
  assert.strictEqual(p.seriesId, 'tpl');
  assert.strictEqual(p.cancelFuture, true);
  assert.strictEqual(p.rematerialize, true);
  assert.strictEqual(p.disable, false);
  assert.strictEqual(p.applyFutureFromYmd, '2026-06-10');
});

test('newRule=null desliga a série (sem recriar)', () => {
  const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: null, todayYmd: TODAY });
  assert.strictEqual(p.disable, true);
  assert.strictEqual(p.cancelFuture, true);
  assert.strictEqual(p.rematerialize, false);
});

test('newRule=undefined: não mexe na regra (só campos)', () => {
  const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: undefined, todayYmd: TODAY });
  assert.strictEqual(p.cancelFuture, false);
  assert.strictEqual(p.rematerialize, false);
  assert.strictEqual(p.disable, false);
});

test('only_this: só a âncora, nada de série', () => {
  const p = planSeriesEdit({ anchor: anchorInstance, scope: 'only_this', newRule: undefined, todayYmd: TODAY });
  assert.strictEqual(p.scopeOnlyThis, true);
  assert.strictEqual(p.cancelFuture, false);
  assert.strictEqual(p.rematerialize, false);
});

test('seriesId resolve do parent quando a âncora é instância', () => {
  const p = planSeriesEdit({ anchor: anchorInstance, scope: 'this_and_future', newRule: 'FREQ=WEEKLY;BYDAY=MO', todayYmd: TODAY });
  assert.strictEqual(p.seriesId, 'tpl');
  assert.strictEqual(p.applyFutureFromYmd, '2026-06-12');
});
