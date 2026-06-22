// src/services/group-chat-tasks.test.js
// Dedup/update anti-duplicação (GROUPCHAT-TASK-DUP-WEEKDAY) + A (dedup de recorrente)
// + B (ação cancel). Mock encadeável do supabase-js que respeita assigned_group_id/ilike
// e registra inserts/updates (necessário p/ testar o cancel, que é await terminal).
const assert = require('node:assert');
const { test } = require('node:test');
const { applyGroupChatTaskActions, titleSimilarity, pickInstanceTarget, findDuplicatePackage, resolveVisibleInstance, filterNewSubtasks, resolveSeriesTemplate, endSeries, reviveSeries } = require('./group-chat-tasks');

function makeDb({ tasks = [], events = [] } = {}) {
  function builder() {
    const st = { filters: {}, op: 'select' };
    function resolve() {
      const rows = tasks.filter((t) => {
        if (st.filters.assigned_group_id && t.assigned_group_id !== st.filters.assigned_group_id) return false;
        if (st.filters.id && t.id !== st.filters.id) return false;
        if (st.filters.recurrence_parent_id && t.recurrence_parent_id !== st.filters.recurrence_parent_id) return false;
        if (st.filters.parent_task_id && t.parent_task_id !== st.filters.parent_task_id) return false;
        if (st.filters.neq_status && t.status === st.filters.neq_status) return false;
        if (st.filters.ilike_title && String(t.title).toLowerCase() !== st.filters.ilike_title) return false;
        return true;
      });
      if (st.op === 'update') {
        rows.forEach((r) => { Object.assign(r, st.patch); events.push({ kind: 'update', id: r.id, patch: st.patch }); });
        return Promise.resolve({ data: rows.map((r) => ({ id: r.id, title: r.title })), error: null });
      }
      if (st.op === 'insert') {
        const row = { id: `new-${tasks.length + 1}`, ...st.row };
        tasks.push(row); events.push({ kind: 'insert', row });
        return Promise.resolve({ data: [row], error: null });
      }
      return Promise.resolve({ data: rows, error: null });
    }
    const b = {
      select() { return b; },
      eq(c, v) { st.filters[c] = v; return b; },
      neq(c, v) { st.filters['neq_' + c] = v; return b; },
      gte() { return b; },
      ilike(c, v) { st.filters['ilike_' + c] = String(v).toLowerCase(); return b; },
      is() { return b; },
      order() { return b; },
      limit() { return b; },
      update(patch) { st.op = 'update'; st.patch = patch; return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; },
      maybeSingle() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      single() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      then(res, rej) { return resolve().then(res, rej); },
    };
    return b;
  }
  return { from: () => builder() };
}

const G = (extra) => ({ assigned_group_id: 'g1', status: 'pending', created_at: new Date().toISOString(), ...extra });

test('titleSimilarity: paráfrase quase-igual ~1, cartões diferentes baixo', () => {
  const a = 'Anne separar cheque Dev Ch Dep 341 001030 e Alf redepositar';
  const b = 'Anne: separar cheque Dev Ch Dep 341 001030 para Alf redepositar';
  assert.ok(titleSimilarity(a, b) >= 0.9);
  assert.ok(titleSimilarity('Cartão 8641 (Recreio)', 'Cartão 8434 (Kids CG)') < 0.5);
});

test('correção de data ATUALIZA no lugar — não cria 2ª tarefa (não-recorrente)', async () => {
  const events = [];
  const tasks = [G({ id: 't1', title: 'Anne separar cheque Dev Ch Dep 341 001030 e Alf redepositar', due_date: '2026-06-16' })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Anne: separar cheque Dev Ch Dep 341 001030 para Alf redepositar', due_date: '2026-06-15' }],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 0);
  assert.strictEqual(r.created.length, 0);
  assert.strictEqual(r.updated.length, 1);
  assert.strictEqual(r.updated[0].changed.due_date, '2026-06-15');
});

test('tarefa genuinamente diferente é criada', async () => {
  const events = [];
  const tasks = [G({ id: 't1', title: 'Cartão 8641 (Recreio)', due_date: '2026-06-17' })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Cartão 8434 (Kids CG)', due_date: '2026-06-25' }],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 1);
  assert.strictEqual(r.created.length, 1);
});

test('duas creates iguais no MESMO batch → 1 insere, 2ª dedup', async () => {
  const events = [];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [
      { action: 'create', title: 'Pedir nota fiscal ao fornecedor', due_date: '2026-06-20' },
      { action: 'create', title: 'Pedir nota fiscal pro fornecedor', due_date: '2026-06-20' },
    ],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 1);
  assert.strictEqual(r.created.length, 1);
  assert.strictEqual(r.updated.length, 1);
});

test('A: create recorrente recente de título parecido ATUALIZA a série (não duplica)', async () => {
  const events = [];
  const tasks = [G({ id: 'rec-1', title: 'Depósito de cheques Vencto 20', due_date: '2026-06-21', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=21' })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'create', title: 'Depósito de cheques Vencto 20', due_date: '2026-06-21', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=20' }],
  });
  assert.strictEqual(events.filter((e) => e.kind === 'insert').length, 0, 'não insere nova série');
  const upd = events.find((e) => e.kind === 'update' && e.id === 'rec-1');
  assert.ok(upd && upd.patch.recurrence_rule === 'FREQ=MONTHLY;BYMONTHDAY=20');
  assert.ok(r.updated.length >= 1);
});

test('B: cancel soft remove tarefa recente do grupo por título', async () => {
  const events = [];
  const tasks = [G({ id: 'dup-1', title: 'Tarefa errada', is_group: false })];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'cancel', title: 'Tarefa errada' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'dup-1' && e.patch.status === 'cancelled'));
  assert.strictEqual((r.cancelled || []).length, 1);
  assert.strictEqual(r.cancelled[0].id, 'dup-1');
});

test('B: cancel não pega tarefa de outro grupo', async () => {
  const events = [];
  const tasks = [{ id: 'x', title: 'Outra', status: 'pending', assigned_group_id: 'OUTRO', created_at: new Date().toISOString() }];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'cancel', title: 'Outra' }],
  });
  assert.strictEqual((r.cancelled || []).length, 0);
  assert.ok(r.failed.some((f) => f.why === 'not_found_in_group'));
});

// ── CARD-RECUR-TEMPLATE-KILL (caso Conciliação de Cartões/Rose 17/06) ──
// Cancelar/concluir por título NÃO pode acertar o MOLDE recorrente, senão a série
// morre de vez (materializeAll pula molde cancelado/concluído → nunca regenera).

test('pickInstanceTarget: protege o molde — nunca retorna template (recurrence_rule)', () => {
  const tpl = { id: 't', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' };
  const inst = { id: 'i', recurrence_rule: null };
  assert.strictEqual(pickInstanceTarget([tpl, inst]).id, 'i');
  assert.strictEqual(pickInstanceTarget([inst, tpl]).id, 'i');
  assert.strictEqual(pickInstanceTarget([tpl]), null); // só o molde → não opera (não mata a série)
  assert.strictEqual(pickInstanceTarget([]), null);
});

test('pickInstanceTarget: prefere a subtarefa-do-CICLO (recurrence_parent_id) à do MOLDE — GROUPREPORT-MOLDE-CICLO-TWIN', () => {
  // Num pacote, molde e ciclo são ambos rule=null. O ciclo tem recurrence_parent_id preenchido;
  // o molde (blueprint) tem null. Cancel/complete/reschedule devem mirar o CICLO (a ocorrência
  // visível), não o molde — foi o que descasou a Venc 20 da Rose (moveu o molde escondido).
  const molde = { id: 'molde', recurrence_rule: null, recurrence_parent_id: null };
  const ciclo = { id: 'ciclo', recurrence_rule: null, recurrence_parent_id: 'molde' };
  assert.strictEqual(pickInstanceTarget([molde, ciclo]).id, 'ciclo');
  assert.strictEqual(pickInstanceTarget([ciclo, molde]).id, 'ciclo'); // ordem não importa
  // one-off (sem ciclo) NÃO regride: usa a própria linha
  assert.strictEqual(pickInstanceTarget([{ id: 'one', recurrence_rule: null, recurrence_parent_id: null }]).id, 'one');
});

test('cancel NUNCA mata o molde recorrente — mira a instância visível', async () => {
  const events = [];
  const tpl = G({ id: 'tpl', title: 'Conciliação de Cartões', is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1' });
  const inst = G({ id: 'inst', title: 'Conciliação de Cartões', is_group: true, recurrence_parent_id: 'tpl' });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [tpl, inst], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'cancel', title: 'Conciliação de Cartões' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'inst' && e.patch.status === 'cancelled'), 'instância cancelada');
  assert.strictEqual(tpl.status, 'pending', 'MOLDE segue vivo → série não morre');
  assert.strictEqual((r.cancelled || [])[0] && r.cancelled[0].id, 'inst');
});

test('complete NUNCA conclui o molde recorrente — mira a instância', async () => {
  const events = [];
  const tpl = G({ id: 'tpl', title: 'Planilha mensal', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=5' });
  const inst = G({ id: 'inst', title: 'Planilha mensal', recurrence_parent_id: 'tpl' });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [tpl, inst], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Planilha mensal' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'inst' && e.patch.status === 'done'), 'instância concluída');
  assert.strictEqual(tpl.status, 'pending', 'molde não concluído');
  assert.strictEqual((r.completed || [])[0] && r.completed[0].id, 'inst');
});

// ── RECUR-PACKAGE-CHURN (anti-duplicação de pacote no <<TASK_GROUP>>) ──
test('findDuplicatePackage: acha pacote ativo ~igual; ignora pacote distinto', () => {
  const mothers = [
    { id: 'tpl', title: 'Conciliação de Cartões', recurrence_rule: 'FREQ=MONTHLY', recurrence_parent_id: null, due_date: '2026-06-01' },
    { id: 'inst', title: 'Conciliação de Cartões', recurrence_rule: null, recurrence_parent_id: 'tpl', due_date: '2026-06-01' },
    { id: 'outro', title: 'Conciliação Bancária (Mês Anterior)', recurrence_rule: null, recurrence_parent_id: null, due_date: '2026-06-01' },
  ];
  assert.ok(findDuplicatePackage(mothers, 'Conciliação de Cartões'));
  assert.strictEqual(findDuplicatePackage(mothers, 'Planilha do financeiro do mês'), null);
  assert.strictEqual(findDuplicatePackage([], 'Qualquer'), null);
});

test('resolveVisibleInstance: molde OU instância qualquer → SEMPRE o ciclo corrente (menor due_date)', () => {
  const tpl = { id: 'tpl', recurrence_rule: 'FREQ=MONTHLY', recurrence_parent_id: null, due_date: '2026-06-01' };
  const jun = { id: 'jun', recurrence_rule: null, recurrence_parent_id: 'tpl', due_date: '2026-06-01' };
  const jul = { id: 'jul', recurrence_rule: null, recurrence_parent_id: 'tpl', due_date: '2026-07-01' };
  const mothers = [tpl, jul, jun];
  assert.strictEqual(resolveVisibleInstance(mothers, tpl).id, 'jun'); // matchou molde → jun
  assert.strictEqual(resolveVisibleInstance(mothers, jul).id, 'jun'); // matchou jul → ainda jun (determinístico)
  assert.strictEqual(resolveVisibleInstance(mothers, jun).id, 'jun');
  const simples = { id: 's', recurrence_rule: null, recurrence_parent_id: null };
  assert.strictEqual(resolveVisibleInstance([simples], simples).id, 's');
});

test('filterNewSubtasks: só os que ainda não existem como filha', () => {
  const existing = ['Cartão 8641 (Recreio)', 'Cartão 2270 (EMLA)'];
  const subs = [{ title: 'Cartão 8641 (Recreio)' }, { title: 'Cartão 1074 (Kids CG)' }];
  const novos = filterNewSubtasks(existing, subs);
  assert.strictEqual(novos.length, 1);
  assert.strictEqual(novos[0].title, 'Cartão 1074 (Kids CG)');
  assert.strictEqual(filterNewSubtasks(existing, []).length, 0);
});

// ── Parte 2 do Grupo-CRUD: reschedule + ciclo de série (encerrar/religar) ──

test('resolveSeriesTemplate: retorna o MOLDE (recurrence_rule), senão null', () => {
  const tpl = { id: 't', recurrence_rule: 'FREQ=MONTHLY' };
  const inst = { id: 'i', recurrence_rule: null };
  assert.strictEqual(resolveSeriesTemplate([inst, tpl]).id, 't');
  assert.strictEqual(resolveSeriesTemplate([inst]), null);
  assert.strictEqual(resolveSeriesTemplate([]), null);
});

test('reschedule: muda due da INSTÂNCIA visível (nunca o molde) + not_found', async () => {
  const events = [];
  const tpl = G({ id: 'tpl', title: 'Planilha mensal', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=5' });
  const inst = G({ id: 'inst', title: 'Planilha mensal', recurrence_parent_id: 'tpl', due_date: '2026-06-05' });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [tpl, inst], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'reschedule', title: 'Planilha mensal', new_due_date: '2026-06-08' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'inst' && e.patch.due_date === '2026-06-08'), 'instância reagendada');
  assert.strictEqual(tpl.status, 'pending', 'molde intocado');
  assert.strictEqual(r.updated.length, 1);

  const r2 = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [], events: [] }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'reschedule', title: 'Nada', new_due_date: '2026-06-08' }],
  });
  assert.ok(r2.failed.some((f) => f.why === 'not_found_in_pool'));
});

test('endSeries: cancela molde + instâncias não-done; preserva done', async () => {
  const events = [];
  const tpl = G({ id: 'tpl', title: 'Conciliação', recurrence_rule: 'FREQ=MONTHLY' });
  const jun = G({ id: 'jun', title: 'Conciliação', recurrence_parent_id: 'tpl', due_date: '2026-06-01' });
  const jul = G({ id: 'jul', title: 'Conciliação', recurrence_parent_id: 'tpl', due_date: '2026-07-01' });
  const maiDone = { id: 'mai', title: 'Conciliação', status: 'done', assigned_group_id: 'g1', recurrence_parent_id: 'tpl', created_at: new Date().toISOString() };
  await endSeries({ supabase: makeDb({ tasks: [tpl, jun, jul, maiDone], events }), templateId: 'tpl' });
  assert.strictEqual(tpl.status, 'cancelled', 'molde cancelado');
  assert.strictEqual(jun.status, 'cancelled');
  assert.strictEqual(jul.status, 'cancelled');
  assert.strictEqual(maiDone.status, 'done', 'done preservado');
});

test('reviveSeries: sem molde cancelado casando → not_found (sem mutação)', async () => {
  const events = [];
  const r = await reviveSeries({ supabase: makeDb({ tasks: [], events }), groupId: 'g1', title: 'Nada' });
  assert.strictEqual(r.revived, false);
  assert.strictEqual(r.reason, 'not_found');
  assert.strictEqual(events.length, 0);
});
