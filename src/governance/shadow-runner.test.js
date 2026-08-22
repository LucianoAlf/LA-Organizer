const { test } = require('node:test');
const assert = require('node:assert');
const { runShadow, derivarCenario } = require('./shadow-runner');

function fakes() {
  const cleaned = [];
  const qa = { id: 'qa1', phone: '5500000000001' };
  const supabase = {
    from(tbl) { return {
      select(){ return this; }, eq(){ return this; }, ilike(){ return this; }, gte(){ return this; }, is(){ return this; }, not(){ return this; }, order(){ return this; },
      maybeSingle: async () => ({ data: tbl === 'collaborators' ? qa : null }),
      insert(){ return { select(){ return { single: async () => ({ data: { id: 'tk1' } }) }; } }; },
      delete(){ cleaned.push(tbl); return { eq: async () => ({}), in: async () => ({}) }; },
      then(r){ return Promise.resolve({ data: [] }).then(r); },
    }; },
  };
  const sent = [];
  const whatsapp = { sendMessage: async (_p, m) => { sent.push(m); return { key:{id:'x'} }; } };
  const engine = { processMessage: async (_p, _t) => { await whatsapp.sendMessage(_p, '✅ feito'); } };
  const turnClaim = { runInTurn: async (_o, fn) => fn() };
  return { supabase, engine, whatsapp, turnClaim, qaPhone: '5500000000001', _cleaned: cleaned, _sent: sent };
}

test('derivarCenario extrai a fala do usuário do evidence', () => {
  const c = derivarCenario({ category: 'dropped_request', evidence: 'USUÁRIO: lança o que falta\nTOM: não consigo' });
  assert.ok(c.turns.length >= 1);
  assert.match(c.turns[0].userText, /lança o que falta/);
});

test('runShadow captura reply e SEMPRE limpa o QA (finally)', async () => {
  const d = fakes();
  const r = await runShadow({ category: 'dropped_request', evidence: 'USUÁRIO: oi\nTOM: x' }, d);
  assert.ok(r.transcript.turns[0].reply.includes('feito'));
  assert.ok(d._cleaned.length > 0, 'cleanup rodou');
});

test('runShadow limpa mesmo se o engine estoura', async () => {
  const d = fakes();
  d.engine.processMessage = async () => { throw new Error('boom'); };
  const r = await runShadow({ category: 'dropped_request', evidence: 'USUÁRIO: oi\nTOM: x' }, d);
  assert.ok(d._cleaned.length > 0, 'cleanup rodou mesmo com erro');
  assert.ok(r.erro || r.transcript);
});
