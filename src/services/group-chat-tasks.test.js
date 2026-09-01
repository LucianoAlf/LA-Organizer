// src/services/group-chat-tasks.test.js
// Dedup/update anti-duplicação (GROUPCHAT-TASK-DUP-WEEKDAY) + A (dedup de recorrente)
// + B (ação cancel). Mock encadeável do supabase-js que respeita assigned_group_id/ilike
// e registra inserts/updates (necessário p/ testar o cancel, que é await terminal).
const assert = require('node:assert');
const { test } = require('node:test');
const { applyGroupChatTaskActions, titleSimilarity, pickInstanceTarget, findDuplicatePackage, resolveVisibleInstance, filterNewSubtasks, resolveSeriesTemplate, endSeries, reviveSeries, matchPoolByPhrase } = require('./group-chat-tasks');

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
        // `ilike` do Postgres trata % como curinga. O dublê comparava igualdade exata e
        // ignorava o %, então um teste de busca PARCIAL passaria/falharia por motivo errado.
        if (st.filters.ilike_title) {
          const alvo = String(t.title).toLowerCase();
          const p = st.filters.ilike_title;
          const ok = p.includes('%')
            ? new RegExp(`^${p.split('%').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(alvo)
            : alvo === p;
          if (!ok) return false;
        }
        if (st.filters.notnull_recurrence_rule && (t.recurrence_rule === null || t.recurrence_rule === undefined)) return false;
        if (st.filters.isnull_recurrence_parent_id && t.recurrence_parent_id != null) return false;
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
      is(c, v) { if (v === null) st.filters['isnull_' + c] = true; return b; },
      not(c, op, v) { if (op === 'is' && v === null) st.filters['notnull_' + c] = true; return b; },
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

test('pickInstanceTarget: exclui filha-BLUEPRINT pelo marcador intrínseco (is_recurrence_template) — verdade única', () => {
  // Verdade única (Fatia 2): o blueprint é rule=null/rpid=null como uma one-off, e a heurística
  // de rpid/rule só o pega quando existe um ciclo pra preferir. O marcador intrínseco é o que o
  // barra SEMPRE — inclusive quando o ciclo sumiu (molde cancelado, instância apagada) e só
  // sobra o blueprint. Foi a borda que vazou nos incidentes Rose apesar do pickInstanceTarget.
  const blueprint = { id: 'bp', recurrence_rule: null, recurrence_parent_id: null, is_recurrence_template: true };
  const inst = { id: 'inst', recurrence_rule: null, recurrence_parent_id: 'bp', is_recurrence_template: false };
  assert.strictEqual(pickInstanceTarget([blueprint, inst]).id, 'inst');
  assert.strictEqual(pickInstanceTarget([inst, blueprint]).id, 'inst');
  assert.strictEqual(pickInstanceTarget([blueprint]), null); // só blueprint → não é trabalho vivo → não opera
  // one-off de verdade (sem marcador) segue operável
  assert.strictEqual(pickInstanceTarget([{ id: 'one', recurrence_rule: null, recurrence_parent_id: null }]).id, 'one');
});

test('endSeries cancela também a filha-BLUEPRINT órfã (parent_task_id=molde) — Fatia 4', async () => {
  const events = [];
  const molde = G({ id: 'molde', is_group: true, recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=3', is_recurrence_template: true });
  const bp = G({ id: 'bp', title: 'Dia 3', parent_task_id: 'molde', is_recurrence_template: true }); // filha-blueprint
  const inst = G({ id: 'inst', is_group: true, recurrence_parent_id: 'molde' });                     // mãe-instância
  await endSeries({ supabase: makeDb({ tasks: [molde, bp, inst], events }), templateId: 'molde' });
  assert.strictEqual(molde.status, 'cancelled', 'molde cancelado');
  assert.strictEqual(inst.status, 'cancelled', 'mãe-instância cancelada');
  assert.strictEqual(bp.status, 'cancelled', 'filha-blueprint órfã cancelada (senão fica pending fantasma)');
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

// ── GROUPCHAT-COMPLETE-COMPOSITE-LABEL-NOMATCH (caso Rose/Financeiro 08/07) ──
// A pessoa cola o LABEL do relatório ("{Pacote}: {Filha} ({Resp})"); o resolvedor casava
// `.ilike(title)` EXATO → nenhum title cru bate → "não achei essa tarefa no grupo". O fallback
// por containment resolve pra FILHA (a mais específica contida na frase), sem tocar o pacote.

test('matchPoolByPhrase: label composto do relatório resolve pra FILHA (containment), não o pacote', () => {
  const pool = [
    { id: 'pkg', title: 'Depósito de Cheques', recurrence_rule: null, recurrence_parent_id: 'master', due_date: '2026-07-06' },
    { id: 'cj', title: 'Venc 05 (prazo dia 06)', recurrence_rule: null, recurrence_parent_id: 'blue', due_date: '2026-07-06' },
    { id: 'ca', title: 'Venc 05 (prazo dia 06)', recurrence_rule: null, recurrence_parent_id: 'blue', due_date: '2026-08-06' },
    { id: 'outra', title: 'Venc 10 (prazo dia 11)', recurrence_rule: null, recurrence_parent_id: 'blue', due_date: '2026-07-11' },
  ];
  const m = matchPoolByPhrase(pool, 'Depósito de Cheques: Venc 05 (prazo dia 06) (Rose)');
  assert.deepStrictEqual(m.map((r) => r.id), ['cj', 'ca'], 'filhas Venc 05 (top spec), por due asc');
  assert.strictEqual(pickInstanceTarget(m).id, 'cj', 'ciclo visível mais antigo aberto = julho');
});

test('matchPoolByPhrase: exato tem prioridade; sem falso-positivo quando falta token', () => {
  const pool = [
    { id: 'a', title: 'Pagar aluguel', due_date: '2026-07-01' },
    { id: 'b', title: 'Conciliação de Cartões', due_date: '2026-07-02' },
  ];
  assert.deepStrictEqual(matchPoolByPhrase(pool, 'pagar ALUGUEL').map((r) => r.id), ['a'], 'exato normalizado (caixa)');
  assert.strictEqual(matchPoolByPhrase(pool, 'conclui a conciliação').length, 0, 'token "cartoes" ausente → não casa');
  assert.strictEqual(matchPoolByPhrase([], 'x').length, 0);
  assert.strictEqual(matchPoolByPhrase(pool, '').length, 0);
});

test('complete: label composto do relatório conclui a FILHA (fallback) — não o pacote — caso Rose', async () => {
  const events = [];
  const pkg = G({ id: 'pkg', title: 'Depósito de Cheques', is_group: true, recurrence_parent_id: 'master', due_date: '2026-07-06' });
  const child = G({ id: 'cj', title: 'Venc 05 (prazo dia 06)', recurrence_parent_id: 'blue', due_date: '2026-07-06' });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [pkg, child], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Depósito de Cheques: Venc 05 (prazo dia 06) (Rose)' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'cj' && e.patch.status === 'done'), 'filha concluída');
  assert.strictEqual((r.completed || [])[0] && r.completed[0].id, 'cj');
  assert.strictEqual(pkg.status, 'pending', 'pacote NÃO concluído por engano');
  assert.strictEqual((r.failed || []).length, 0, 'sem not_found');
});

// ── GROUPCHAT-CREATE-COMPOSITE-LABEL-DUP (caso Rose 31/07) ────────────────────
// A Rose pediu "remaneja essa tarefa pra hoje, sempre último dia do mês". O relatório
// mostra a filha do pacote com o prefixo ("Repasses de Cartões - Maquininha: CG"), mas no
// banco ela se chama só "CG". O dedup do create (pool de 24h + similaridade de tokens) não
// reconheceu → criou 3 tarefas NOVAS soltas com recurrence_rule, deixou as filhas em 30/07,
// e as novas sumiram do relatório (o builder esconde molde). Ficaram 6 onde deviam ser 3.
const { _resolvePackageChildByLabel } = require('./group-chat-tasks');

function _fakeSb(rows) {
  const chain = {
    select: () => chain, eq: () => chain, neq: () => chain,
    limit: async () => ({ data: rows }),
  };
  return { from: () => chain };
}
const GID = 'grupo-1';
const CENARIO_REAL = [
  { id: 'cont', title: 'Repasses de Cartões - Maquininha', is_group: true, parent_task_id: null, recurrence_rule: null, due_date: '2026-07-30' },
  { id: 'f-cg', title: 'CG', is_group: false, parent_task_id: 'cont', recurrence_rule: null, due_date: '2026-07-30' },
  { id: 'f-barra', title: 'Barra', is_group: false, parent_task_id: 'cont', recurrence_rule: null, due_date: '2026-07-30' },
];

test('label composto do pacote resolve na FILHA real (caso Rose 31/07)', async () => {
  const alvo = await _resolvePackageChildByLabel({
    supabase: _fakeSb(CENARIO_REAL), groupId: GID,
    label: 'Repasses de Cartões - Maquininha: CG',
  });
  assert.ok(alvo, 'devia achar a filha');
  assert.strictEqual(alvo.id, 'f-cg');
});

test('ANTI falso-positivo: título novo que só CONTÉM o nome da filha NÃO casa', async () => {
  const alvo = await _resolvePackageChildByLabel({
    supabase: _fakeSb(CENARIO_REAL), groupId: GID,
    label: 'Comprar cadeiras: CG',   // prefixo NÃO é container do grupo
  });
  assert.strictEqual(alvo, null);
});

test('sem dois-pontos não tenta resolver como label de pacote', async () => {
  const alvo = await _resolvePackageChildByLabel({
    supabase: _fakeSb(CENARIO_REAL), groupId: GID, label: 'Comprar lâmpadas',
  });
  assert.strictEqual(alvo, null);
});

test('nunca mira o MOLDE da série (só instância visível)', async () => {
  const comMolde = CENARIO_REAL.concat([
    { id: 'molde', title: 'CG', is_group: false, parent_task_id: 'cont', recurrence_rule: 'FREQ=MONTHLY', due_date: '2026-07-30' },
  ]);
  const alvo = await _resolvePackageChildByLabel({
    supabase: _fakeSb(comMolde), groupId: GID, label: 'Repasses de Cartões - Maquininha: CG',
  });
  assert.strictEqual(alvo.id, 'f-cg', 'tem que pegar a instância, nunca o molde');
});

// ── GROUPPKG-CONTAINER-COMPLETABLE-GROUP (05/08) ──────────────────────────────
// Mesmo dano do caso Rose (03/08), por OUTRA porta. Aquele veio pelo chat 1:1, onde o
// container era listado no prompt; fechei o reader. Este resolve por TÍTULO direto na
// tabela, então o filtro do pool não protege: "conclui a Conciliação de Cartões" no
// grupo fecha a PASTA e deixa os 6 cartões abertos por dentro. Na varredura de 05/08,
// as 14 pastas abertas do banco tinham assigned_group_id — todas alcançáveis.
test('complete por título NÃO fecha o container do pacote — fecha pasta e deixa filha aberta', async () => {
  const events = [];
  const pasta = G({ id: 'pasta', title: 'Conciliação de Cartões', is_group: true });
  const filha = G({ id: 'filha', title: 'Cartão MP Barra', parent_task_id: 'pasta' });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [pasta, filha], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Conciliação de Cartões' }],
  });
  assert.strictEqual(pasta.status, 'pending', 'fechou a PASTA — a filha continua aberta por dentro');
  assert.ok(!events.find((e) => e.kind === 'update' && e.id === 'pasta' && e.patch.status === 'done'));
  assert.ok((r.failed || []).some((f) => f.why === 'not_found_in_pool'),
    'tem que falhar honesto ("não achei essa tarefa no grupo"), não em silêncio');
});

test('complete da FILHA segue funcionando — o guard não pode calar o caminho normal', async () => {
  const events = [];
  const pasta = G({ id: 'pasta', title: 'Conciliação de Cartões', is_group: true });
  const filha = G({ id: 'filha', title: 'Cartão MP Barra', parent_task_id: 'pasta' });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [pasta, filha], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Cartão MP Barra' }],
  });
  assert.strictEqual((r.completed || [])[0] && r.completed[0].id, 'filha');
});

test('RESCHEDULE do container CONTINUA valendo — mover o prazo do pacote é legítimo', async () => {
  const events = [];
  const pasta = G({ id: 'pasta', title: 'Conciliação de Cartões', is_group: true });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [pasta], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'reschedule', title: 'Conciliação de Cartões', new_due_date: '2026-08-20' }],
  });
  assert.strictEqual((r.updated || [])[0] && r.updated[0].id, 'pasta',
    'o guard vazou pro reschedule e quebrou a edição de prazo do pacote');
});

// ── GROUPCHAT-COMPLETE-TEMPLATE-ONLY-CYCLE (Rose 06/08, 22h) ─────────────────
// "relatório mensal feito" falhava com not_found_in_pool. Raiz: quando a mensal ainda não
// gerou instância, o ciclo corrente É O PRÓPRIO MOLDE — o materializeSeries semeia a data do
// molde como já existente, de propósito, pra não duplicar (recurrence-engine ~108). E o
// pickInstanceTarget descarta molde, também de propósito, porque concluir molde MATA a série
// (materializeAll não regenera molde done). Resultado: ninguém conclui o ciclo corrente.
//
// Fix: materializa a ocorrência do molde como instância JÁ CONCLUÍDA. O molde nunca muda de
// status — é ele que gera os meses seguintes.
test('conclui mensal que só tem MOLDE: cria instância done e NÃO toca no status do molde', async () => {
  const events = [];
  const molde = G({ id: 'tpl', title: 'Relatório Mensal Financeiro (Grupo)', due_date: '2026-08-05',
                    recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=5', recurrence_parent_id: null });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [molde], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Relatório Mensal Financeiro (Grupo)' }],
  });
  assert.strictEqual(molde.status, 'pending', 'MOLDE mudou de status — a série morre');
  const ins = events.find((e) => e.kind === 'insert');
  assert.ok(ins, 'não materializou a ocorrência');
  assert.strictEqual(ins.row.recurrence_parent_id, 'tpl');
  assert.strictEqual(ins.row.recurrence_rule, null, 'a instância nasceu como molde');
  assert.strictEqual(ins.row.due_date, '2026-08-05', 'instância fora da data do ciclo corrente');
  assert.strictEqual(ins.row.status, 'done');
  assert.strictEqual((r.completed || []).length, 1);
});

test('se a instância JÁ existe, conclui ela e não materializa nada', async () => {
  const events = [];
  const molde = G({ id: 'tpl', title: 'Faturamento Mensal', due_date: '2026-08-06',
                    recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=6', recurrence_parent_id: null });
  const inst = G({ id: 'inst', title: 'Faturamento Mensal', due_date: '2026-08-06', recurrence_parent_id: 'tpl' });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [molde, inst], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Faturamento Mensal' }],
  });
  assert.ok(!events.find((e) => e.kind === 'insert'), 'materializou duplicata tendo instância');
  assert.strictEqual(inst.status, 'done');
  assert.strictEqual(molde.status, 'pending');
  assert.strictEqual((r.completed || [])[0].id, 'inst');
});

test('tarefa simples (sem recorrência) não materializa nada — caminho normal intacto', async () => {
  const events = [];
  const t = G({ id: 'x', title: 'Pagar boleto', due_date: '2026-08-06' });
  await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [t], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Pagar boleto' }],
  });
  assert.ok(!events.find((e) => e.kind === 'insert'));
  assert.strictEqual(t.status, 'done');
});

// Rose 06/08 22h53, DEPOIS do primeiro fix: "tom, relatório pode concluir" ainda falhou.
// Motivo: a materialização só disparava quando o `ilike` EXATO já tinha achado o molde. Se o
// LLM emite um apelido curto, `found` vem vazio e nada acontece. O `matchPoolByPhrase` também
// não salva: ele exige o título CONTIDO na frase ("Relatório Mensal Financeiro (Grupo)" ⊄
// "relatório"), que é a direção oposta da que a pessoa fala.
test('apelido curto acha o MOLDE por busca parcial e conclui o ciclo (caso "relatório")', async () => {
  const events = [];
  const molde = G({ id: 'tpl', title: 'Relatório Mensal Financeiro (Grupo)', due_date: '2026-08-05',
                    recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=5', recurrence_parent_id: null });
  const outra = G({ id: 'z', title: 'Faturamento Mensal', due_date: '2026-08-06',
                    recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=6', recurrence_parent_id: null });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [molde, outra], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'relatório' }],
  });
  assert.strictEqual(molde.status, 'pending', 'MOLDE mudou de status — a série morre');
  const ins = events.find((e) => e.kind === 'insert');
  assert.ok(ins, 'apelido curto não achou o molde');
  assert.strictEqual(ins.row.recurrence_parent_id, 'tpl');
  assert.strictEqual(ins.row.status, 'done');
  assert.strictEqual((r.completed || []).length, 1);
});

test('apelido AMBÍGUO entre dois moldes falha honesto — não escolhe no chute', async () => {
  const events = [];
  const a = G({ id: 't1', title: 'Relatório Mensal Financeiro', due_date: '2026-08-05', recurrence_rule: 'FREQ=MONTHLY', recurrence_parent_id: null });
  const b = G({ id: 't2', title: 'Relatório Mensal de Caixa', due_date: '2026-08-05', recurrence_rule: 'FREQ=MONTHLY', recurrence_parent_id: null });
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks: [a, b], events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'relatório mensal' }],
  });
  assert.ok(!events.find((e) => e.kind === 'insert'), 'materializou com dois candidatos');
  assert.ok((r.failed || []).some((f) => f.why === 'not_found_in_pool'));
});

// ── Cascata do reschedule no PACOTE (incidente Rose, 08/08 11:15) ────────────
// O cancel já descia para as filhas (`if (target.is_group)`); o reschedule não. Resultado:
// o TOM movia o container e afirmava "passei as três subtarefas", enquanto elas ficavam no
// dia velho. A Rose repetiu "ainda tá 30" três vezes e ele repetiu que tinha feito.
test('reschedule de CONTAINER move as filhas junto (pacote é uma unidade)', async () => {
  const events = [];
  const tasks = [
    G({ id: 'pkg', title: 'Repasses de Cartões - Maquininha', due_date: '2026-08-30', is_group: true }),
    G({ id: 'f1', title: 'Barra', due_date: '2026-08-30', parent_task_id: 'pkg' }),
    G({ id: 'f2', title: 'Recreio', due_date: '2026-08-30', parent_task_id: 'pkg' }),
    G({ id: 'f3', title: 'CG', due_date: '2026-08-30', parent_task_id: 'pkg' }),
  ];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'reschedule', title: 'Repasses de Cartões - Maquininha', new_due_date: '2026-08-31' }],
  });
  assert.equal(r.failed.length, 0, JSON.stringify(r.failed));
  assert.equal(tasks.find((t) => t.id === 'pkg').due_date, '2026-08-31', 'o container tem que mover');
  for (const id of ['f1', 'f2', 'f3']) {
    assert.equal(tasks.find((t) => t.id === id).due_date, '2026-08-31', `a filha ${id} ficou pra trás`);
  }
});

test('reschedule de tarefa COMUM não arrasta ninguém (anti-regressão)', async () => {
  const events = [];
  const tasks = [
    G({ id: 's1', title: 'Faturamento Mensal', due_date: '2026-08-08' }),
    G({ id: 's2', title: 'Outra coisa', due_date: '2026-08-08' }),
  ];
  await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'reschedule', title: 'Faturamento Mensal', new_due_date: '2026-08-12' }],
  });
  assert.equal(tasks.find((t) => t.id === 's1').due_date, '2026-08-12');
  assert.equal(tasks.find((t) => t.id === 's2').due_date, '2026-08-08', 'não podia encostar na outra');
});

// ── GROUPCHAT-PICKTARGET-SELECT-CEGO (caso Rose 12/08) ───────────────────────────────
// pickInstanceTarget decide pelo `recurrence_parent_id`: filha-INSTÂNCIA tem, filha-TEMPLATE
// não. A função sempre esteve certa — mas complete/cancel/reschedule buscavam
// `select('id, title, recurrence_rule, is_group')`, SEM essa coluna. Sem o campo, toda linha
// tem `undefined`, `cyclic` fica vazio e ele cai no fallback `instances[0]`: a primeira por
// due_date, que EMPATA entre a real e a fantasma.
//
// Medido no Replay Lab (cenário D, 13/08): o TOM fechou `completed=4` existindo 2 alvos —
// as 2 reais e as 2 fantasmas. É o caso da Rose reproduzido.
//
// A lição é o chamador, não a função: helper que decide por um campo só funciona se quem
// chama trouxer o campo. Este teste ancora os DOIS lados.
test('pickInstanceTarget: sem recurrence_parent_id no select, não distingue instância de template', () => {
  const semColuna = [
    { id: 'template', title: 'Cartão 8516 (Barra)', recurrence_rule: null },
    { id: 'instancia', title: 'Cartão 8516 (Barra)', recurrence_rule: null },
  ];
  // Documenta o modo de falha: cai no primeiro da lista, seja ele qual for.
  assert.strictEqual(pickInstanceTarget(semColuna).id, 'template');
});

test('pickInstanceTarget: COM a coluna, escolhe a instância mesmo vindo depois', () => {
  const comColuna = [
    { id: 'template', title: 'Cartão 8516 (Barra)', recurrence_rule: null, recurrence_parent_id: null },
    { id: 'instancia', title: 'Cartão 8516 (Barra)', recurrence_rule: null, recurrence_parent_id: 'tpl-filha' },
  ];
  assert.strictEqual(pickInstanceTarget(comColuna).id, 'instancia');
});

// GROUPCHAT-FALLBACK-VISIBILITY (varredura 25/08) — reschedule/cancel PRIMÁRIOS também miravam o
// ciclo VELHO done-twin (mesma raiz do complete). Agora funilam no pickVisibleInstance.
test('reschedule: mira o ciclo corrente (25/08), não o 25/07 done-twin', async () => {
  const events = [];
  const tasks = [
    G({ id: 'jul-done', title: 'Cartão X', due_date: '2026-07-25', status: 'done', recurrence_parent_id: 'tpl' }),
    G({ id: 'jul-open', title: 'Cartão X', due_date: '2026-07-25', recurrence_parent_id: 'tpl' }),
    G({ id: 'aug-open', title: 'Cartão X', due_date: '2026-08-25', recurrence_parent_id: 'tpl' }),
  ];
  await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'reschedule', title: 'Cartão X', new_due_date: '2026-09-01' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'aug-open' && e.patch.due_date === '2026-09-01'), 'remarcou a 25/08');
  assert.ok(!events.find((e) => e.kind === 'update' && e.id === 'jul-open'), 'NÃO tocou a 25/07 done-twin');
});

test('cancel: mira o ciclo corrente (25/08), não o 25/07 done-twin', async () => {
  const events = [];
  const tasks = [
    G({ id: 'jd', title: 'Cartão Y', due_date: '2026-07-25', status: 'done', recurrence_parent_id: 'tpl' }),
    G({ id: 'jo', title: 'Cartão Y', due_date: '2026-07-25', recurrence_parent_id: 'tpl' }),
    G({ id: 'ao', title: 'Cartão Y', due_date: '2026-08-25', recurrence_parent_id: 'tpl' }),
  ];
  await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'cancel', title: 'Cartão Y' }],
  });
  assert.ok(events.find((e) => e.kind === 'update' && e.id === 'ao' && e.patch.status === 'cancelled'), 'cancelou a 25/08');
  assert.ok(!events.find((e) => e.kind === 'update' && e.id === 'jo'), 'NÃO tocou a 25/07');
});

// CASO ROSE 31/08 22:48 (KI GROUP-DIGEST-NAME-UNCLOSABLE) --------------------
// O teste do caso Rose de cima passa porque ali a FILHA tem nome longo ('Venc 05 (prazo dia
// 06)') e vence o pacote no containment por especificidade. AQUI a filha e CURTA ('Barra',
// 1 token) e o PACOTE tem 3 tokens -- o matchPoolByPhrase devolve o pacote, o guard
// anti-container derruba, o fallback de molde nao casa (ilike na direcao errada) e a Rose
// ouviu 'nao achei essa tarefa no grupo' sobre trabalho listado no proprio digest. Foi a
// gota que tirou o financeiro do TOM. O resolvedor certo (_resolvePackageChildByLabel,
// 31/07) ja existia -- construido pro CREATE e nunca ligado no COMPLETE.
test('complete: label composto com filha CURTA conclui a filha do pacote — caso Rose 31/08', async () => {
  const events = [];
  const tasks = [
    G({ id: 'pkg', title: 'Repasses de Cartões - Maquininha', is_group: true, due_date: '2026-08-31' }),
    G({ id: 'barra', title: 'Barra', parent_task_id: 'pkg', due_date: '2026-08-31' }),
    G({ id: 'cg', title: 'CG', parent_task_id: 'pkg', due_date: '2026-08-31' }),
    G({ id: 'recreio', title: 'Recreio', parent_task_id: 'pkg', due_date: '2026-08-31' }),
    // gemea CANCELADA com o nome antigo composto (residuo da refatoracao 18/08): nao pode
    // ser alvo nem atrapalhar a resolucao.
    G({ id: 'twin', title: 'Repasses de Cartões - Maquininha: Barra', status: 'cancelled', due_date: '2026-08-31' }),
  ];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Repasses de Cartões - Maquininha: Barra' }],
  });
  assert.strictEqual((r.failed || []).length, 0, JSON.stringify(r.failed));
  assert.strictEqual((r.completed || [])[0] && r.completed[0].id, 'barra');
  const pkg = tasks.find((t) => t.id === 'pkg');
  assert.strictEqual(pkg.status, 'pending', 'o container NAO pode ser fechado');
});

test('complete: label composto que NAO corresponde a filha nenhuma segue falha honesta', async () => {
  const tasks = [
    G({ id: 'pkg', title: 'Repasses de Cartões - Maquininha', is_group: true, due_date: '2026-08-31' }),
    G({ id: 'barra', title: 'Barra', parent_task_id: 'pkg', due_date: '2026-08-31' }),
  ];
  const r = await applyGroupChatTaskActions({
    supabase: makeDb({ tasks, events: [] }), groupId: 'g1', senderCollabId: 'c1',
    actions: [{ action: 'complete', title: 'Repasses de Cartões - Maquininha: Niteroi' }],
  });
  assert.strictEqual((r.completed || []).length, 0, 'nao pode concluir no chute');
});
