const { test } = require('node:test');
const assert = require('node:assert');
const { runShadow, derivarCenario } = require('./shadow-runner');

function fakes() {
  const cleaned = [];
  const deletedBy = []; // { tbl, coluna }
  const qa = { id: 'qa1', phone: '5500000000001' };
  const supabase = {
    from(tbl) { return {
      select(){ return this; }, eq(){ return this; }, ilike(){ return this; }, gte(){ return this; }, is(){ return this; }, not(){ return this; }, order(){ return this; },
      maybeSingle: async () => ({ data: tbl === 'collaborators' ? qa : null }),
      insert(){ return { select(){ return { single: async () => ({ data: { id: 'tk1' } }) }; } }; },
      delete(){
        cleaned.push(tbl);
        return {
          eq: async (coluna) => { deletedBy.push({ tbl, coluna }); return {}; },
          in: async (coluna) => { deletedBy.push({ tbl, coluna }); return {}; },
        };
      },
      then(r){ return Promise.resolve({ data: [] }).then(r); },
    }; },
  };
  const sent = [];
  const whatsapp = { sendMessage: async (_p, m) => { sent.push(m); return { key:{id:'x'} }; } };
  const engine = { processMessage: async (_p, _t) => { await whatsapp.sendMessage(_p, '✅ feito'); } };
  const turnClaim = { runInTurn: async (_o, fn) => fn() };
  return { supabase, engine, whatsapp, turnClaim, qaPhone: '5500000000001', _cleaned: cleaned, _deletedBy: deletedBy, _sent: sent };
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

test('derivarCenario também casa "Pessoa:" (convenção do projeto)', () => {
  const c = derivarCenario({ category: 'dropped_request', evidence: 'Pessoa: lança o que falta\nTOM: não consigo' });
  assert.ok(c.turns.length >= 1);
  assert.match(c.turns[0].userText, /lança o que falta/);
});

test('runShadow passa persisted real (habitos/tarefas) pro turno, não {}', async () => {
  const d = fakes();
  const r = await runShadow({ category: 'confabulation', evidence: 'USUÁRIO: oi\nTOM: x' }, d);
  assert.ok(r.transcript.turns[0].persisted, 'persisted existe');
  assert.deepStrictEqual(Object.keys(r.transcript.turns[0].persisted).sort(), ['habitos', 'tarefas_novas', 'tarefas_recorrentes'].sort());
});

test('cleanup usa as colunas corretas por tabela (tasks=assigned_to, resto=collaborator_id)', async () => {
  const d = fakes();
  await runShadow({ category: 'confabulation', evidence: 'USUÁRIO: oi\nTOM: x' }, d);
  const tasksDel = d._deletedBy.find((x) => x.tbl === 'tasks');
  const habitsDel = d._deletedBy.find((x) => x.tbl === 'habits');
  const convDel = d._deletedBy.find((x) => x.tbl === 'conversation_history');
  assert.ok(tasksDel, 'tasks foi limpo');
  assert.strictEqual(tasksDel.coluna, 'assigned_to');
  assert.ok(habitsDel, 'habits foi limpo');
  assert.strictEqual(habitsDel.coluna, 'collaborator_id');
  assert.ok(convDel, 'conversation_history foi limpo');
  assert.strictEqual(convDel.coluna, 'collaborator_id');
});
