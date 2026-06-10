import { describe, it, expect } from 'vitest';
import { planSeriesEdit } from './planSeriesEdit';

const TODAY = '2026-06-10';
const anchorTemplate = { id: 'tpl', recurrence_parent_id: null, due_date: '2026-06-10' };
const anchorInstance = { id: 'inst', recurrence_parent_id: 'tpl', due_date: '2026-06-12' };

describe('planSeriesEdit', () => {
  it('this_and_future com regra nova: cancela futuras e re-materializa', () => {
    const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: 'FREQ=DAILY', todayYmd: TODAY });
    expect(p.seriesId).toBe('tpl');
    expect(p.cancelFuture).toBe(true);
    expect(p.rematerialize).toBe(true);
    expect(p.disable).toBe(false);
    expect(p.applyFutureFromYmd).toBe('2026-06-10');
  });

  it('newRule=null desliga a série (sem recriar)', () => {
    const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: null, todayYmd: TODAY });
    expect(p.disable).toBe(true);
    expect(p.cancelFuture).toBe(true);
    expect(p.rematerialize).toBe(false);
  });

  it('newRule=undefined: não mexe na regra (só campos)', () => {
    const p = planSeriesEdit({ anchor: anchorTemplate, scope: 'this_and_future', newRule: undefined, todayYmd: TODAY });
    expect(p.cancelFuture).toBe(false);
    expect(p.rematerialize).toBe(false);
    expect(p.disable).toBe(false);
  });

  it('only_this: só a âncora, nada de série', () => {
    const p = planSeriesEdit({ anchor: anchorInstance, scope: 'only_this', newRule: undefined, todayYmd: TODAY });
    expect(p.scopeOnlyThis).toBe(true);
    expect(p.cancelFuture).toBe(false);
    expect(p.rematerialize).toBe(false);
  });

  it('seriesId resolve do parent quando a âncora é instância', () => {
    const p = planSeriesEdit({ anchor: anchorInstance, scope: 'this_and_future', newRule: 'FREQ=WEEKLY;BYDAY=MO', todayYmd: TODAY });
    expect(p.seriesId).toBe('tpl');
    expect(p.applyFutureFromYmd).toBe('2026-06-12');
  });
});
