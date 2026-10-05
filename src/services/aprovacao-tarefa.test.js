'use strict';
// APROVACAO-DE-TAREFA-NAO-CHEGAVA (auditoria 05/10). Tarefa de tipo com requires_approval nascia
// awaiting_confirmation, o TOM dizia "entra pendente de aprovação do Luciano… vou avisar quando
// aprovarem", e o pedido NUNCA saía pra ninguém: 15 tarefas paradas desde 30/05, todas da Rafinha
// (operacoes-tecnicas). Casos reais: c2a87b2f "Infiltração teto banheiro — Campo Grande" (03/10),
// 547edde2 "Comprar 2 pads de estudo — Barra" (02/10), 5d0ff547 "Comprar 5 cabos P10 — R$51,90".
// Nenhum envio real: enviar/registrarAviso são injetados.
const test = require('node:test');
const assert = require('node:assert');
const approvals = require('./approvals');
const {
  montarCardAprovacao, extrairValor, abrirAprovacaoDeTarefa, decidirAprovacaoDeTarefa, avisoAoSolicitante,
} = require('./aprovacao-tarefa');

// Fake mínimo do supabase-js (tabelas em memória). `payload->>x` compara como texto, igual ao PostgREST.
function fakeSupabase(tables = {}) {
  let seq = 0;
  const get = (row, col) => {
    if (col.includes('->>')) {
      const [a, b] = col.split('->>');
      const v = row[a] ? row[a][b] : undefined;
      return v == null ? null : String(v);
    }
    return row[col];
  };
  function from(name) {
    const t = tables[name] || (tables[name] = []);
    const st = { op: 'select', filters: [], patch: null, row: null, limit: null, one: false };
    const q = {
      select() { return q; },
      insert(row) { st.op = 'insert'; st.row = row; return q; },
      update(p) { st.op = 'update'; st.patch = p; return q; },
      eq(c, v) { st.filters.push((r) => get(r, c) === v); return q; },
      neq(c, v) { st.filters.push((r) => get(r, c) !== v); return q; },
      is(c, v) { st.filters.push((r) => (get(r, c) ?? null) === v); return q; },
      gte(c, v) { st.filters.push((r) => String(get(r, c)) >= v); return q; },
      in(c, vs) { st.filters.push((r) => vs.includes(get(r, c))); return q; },
      order() { return q; },
      limit(n) { st.limit = n; return q; },
      single() { st.one = true; return q; },
      maybeSingle() { st.one = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      if (st.op === 'insert') {
        const row = { id: `intent-${++seq}`, asked_at: new Date().toISOString(), resolved_at: null, ...st.row };
        t.push(row);
        return { data: st.one ? row : [row], error: null };
      }
      let rows = t.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === 'update') { rows.forEach((r) => Object.assign(r, st.patch)); return { data: rows.map((r) => ({ ...r })), error: null }; }
      if (st.limit) rows = rows.slice(0, st.limit);
      if (st.one) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    return q;
  }
  return { from, tables };
}

const RAFINHA = { id: 'c9e72a40-0000-4000-8000-000000000001', full_name: 'Rafinha', phone: '5521900000001', role: 'collaborator' };
const LUCIANO = { id: 'aaaaaaaa-0000-4000-8000-000000000002', full_name: 'Luciano Alf', phone: '5521900000002', role: 'director' };
const TAREFA_REAL = { id: 'c2a87b2f-0000-4000-8000-000000000003', title: 'Infiltração teto banheiro — Campo Grande', description: null, status: 'awaiting_confirmation', created_by: RAFINHA.id, assigned_to: RAFINHA.id };

function cenario({ aprovador = LUCIANO, enviarFalha = false } = {}) {
  const supabase = fakeSupabase({ tasks: [{ ...TAREFA_REAL }], pending_intents: [] });
  const enviados = [];
  const historico = [];
  const deps = {
    supabase,
    approvals,
    enviar: async (phone, text) => { if (enviarFalha) throw new Error('uazapi 503'); enviados.push({ phone, text }); },
    registrarAviso: async (id, text, phone) => { historico.push({ id, text, phone }); return true; },
    resolverAprovador: async () => aprovador,
    gerarToken: () => 'APROV-AB12',
  };
  return { supabase, enviados, historico, deps };
}

test('valor: acha R$ no título real "Comprar 5 cabos P10 — R$51,90"', () => {
  assert.strictEqual(extrairValor('Comprar 5 cabos P10 — R$51,90'), 'R$51,90');
  assert.strictEqual(extrairValor('Infiltração teto banheiro — Campo Grande', null), null);
  assert.strictEqual(extrairValor('sem valor', 'orçamento de R$ 1.250,00 do pedreiro'), 'R$ 1.250,00');
});

test('card: título, quem pediu, departamento/tipo, valor e os dois comandos com o token', () => {
  const card = montarCardAprovacao({
    titulo: 'Comprar 5 cabos P10 — R$51,90', solicitante: 'Rafinha',
    departamento: 'Operações Técnicas', tipo: 'Compra / fornecedor', valor: 'R$51,90', token: 'APROV-AB12',
  });
  assert.match(card, /\*Rafinha\*/);
  assert.match(card, /Operações Técnicas · Compra \/ fornecedor/);
  assert.match(card, /\*Comprar 5 cabos P10 — R\$51,90\*/);
  assert.match(card, /💰 R\$51,90/);
  assert.match(card, /\*APROVA APROV-AB12\* ou \*REJEITA APROV-AB12\*/);
});

test('abrir: caso real c2a87b2f — abre approval_pending no nome do Luciano, manda o card e grava no histórico dele', async () => {
  const { supabase, enviados, historico, deps } = cenario();
  const r = await abrirAprovacaoDeTarefa(deps, { task: TAREFA_REAL, solicitante: RAFINHA, departamento: 'Operações Técnicas', tipo: 'Obra / infraestrutura' });
  assert.strictEqual(r.status, 'enviada');
  assert.strictEqual(r.token, 'APROV-AB12');
  const it = supabase.tables.pending_intents;
  assert.strictEqual(it.length, 1);
  assert.strictEqual(it[0].collaborator_id, LUCIANO.id);
  assert.strictEqual(it[0].kind, 'approval_pending');
  assert.deepStrictEqual(
    { d: it[0].payload.domain, ref: it[0].payload.ref_id, tok: it[0].payload.token, req: it[0].payload.requester_id, tel: it[0].payload.requester_phone },
    { d: 'task', ref: TAREFA_REAL.id, tok: 'APROV-AB12', req: RAFINHA.id, tel: RAFINHA.phone },
  );
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].phone, LUCIANO.phone);
  assert.match(enviados[0].text, /Infiltração teto banheiro — Campo Grande/);
  assert.deepStrictEqual(historico.map((h) => h.id), [LUCIANO.id]);
  assert.strictEqual(historico[0].text, enviados[0].text);
});

test('abrir é idempotente: 2ª chamada pra mesma tarefa não manda 2º card nem abre 2ª pendência', async () => {
  const { supabase, enviados, deps } = cenario();
  await abrirAprovacaoDeTarefa(deps, { task: TAREFA_REAL, solicitante: RAFINHA });
  const r2 = await abrirAprovacaoDeTarefa(deps, { task: TAREFA_REAL, solicitante: RAFINHA });
  assert.strictEqual(r2.status, 'ja_aberta');
  assert.strictEqual(r2.token, 'APROV-AB12');
  assert.strictEqual(supabase.tables.pending_intents.length, 1);
  assert.strictEqual(enviados.length, 1);
});

test('sem aprovador na matriz: não abre pendência, não envia, e o aviso ao solicitante NÃO promete avisar', async () => {
  const { supabase, enviados, deps } = cenario({ aprovador: null });
  const r = await abrirAprovacaoDeTarefa(deps, { task: TAREFA_REAL, solicitante: RAFINHA });
  assert.strictEqual(r.status, 'sem_aprovador');
  assert.strictEqual(supabase.tables.pending_intents.length, 0);
  assert.strictEqual(enviados.length, 0);
  const aviso = avisoAoSolicitante(r, TAREFA_REAL.title);
  assert.doesNotMatch(aviso, /te aviso|vou avisar|aviso quando/i);
  assert.match(aviso, /não consigo te avisar/);
});

test('card que não saiu: pendência fechada (não fica aprovação fantasma) e o aviso diz que não saiu', async () => {
  const { supabase, historico, deps } = cenario({ enviarFalha: true });
  const r = await abrirAprovacaoDeTarefa(deps, { task: TAREFA_REAL, solicitante: RAFINHA });
  assert.strictEqual(r.status, 'falhou_envio');
  assert.strictEqual(supabase.tables.pending_intents[0].resolution, 'superseded');
  assert.strictEqual(historico.length, 0);
  assert.match(avisoAoSolicitante(r, TAREFA_REAL.title), /não saiu/);
});

test('aviso de envio ao solicitante nomeia o aprovador e só promete o que o sistema faz', () => {
  const aviso = avisoAoSolicitante({ status: 'enviada', aprovador: LUCIANO, token: 'APROV-AB12' }, TAREFA_REAL.title);
  assert.match(aviso, /\*Luciano Alf\*/);
  assert.match(aviso, /Infiltração teto banheiro — Campo Grande/);
  assert.strictEqual(avisoAoSolicitante({ status: 'ja_aberta' }, 'x'), null);
});

async function abertoEDecidido(decisao, motivo) {
  const c = cenario();
  await abrirAprovacaoDeTarefa(c.deps, { task: TAREFA_REAL, solicitante: RAFINHA });
  c.enviados.length = 0; c.historico.length = 0;
  const [intent] = await approvals.listOpenApprovals(c.supabase, LUCIANO.id);
  const r = await decidirAprovacaoDeTarefa(c.deps, { intent, decisao, motivo, aprovador: LUCIANO });
  return { ...c, r };
}

test('APROVA: tarefa vira pending (dono mantido), pendência confirmed, Rafinha avisada + histórico dela', async () => {
  const { supabase, enviados, historico, r } = await abertoEDecidido('approve');
  const t = supabase.tables.tasks[0];
  assert.strictEqual(t.status, 'pending');
  assert.strictEqual(t.assigned_to, RAFINHA.id);
  assert.strictEqual(t.updated_by, LUCIANO.id);
  assert.strictEqual(supabase.tables.pending_intents[0].resolution, 'confirmed');
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].phone, RAFINHA.phone);
  assert.match(enviados[0].text, /^✅ .*Infiltração teto banheiro — Campo Grande.*aprovada por Luciano Alf/);
  assert.deepStrictEqual(historico.map((h) => h.id), [RAFINHA.id]);
  assert.strictEqual(r.avisou, true);
  assert.match(r.reply, /aprovada/);
  assert.match(r.reply, /Avisei/);
});

test('REJEITA com motivo: tarefa cancelled, pendência denied, Rafinha avisada com o motivo', async () => {
  const { supabase, enviados, historico, r } = await abertoEDecidido('reject', 'orcamento alto');
  assert.strictEqual(supabase.tables.tasks[0].status, 'cancelled');
  assert.strictEqual(supabase.tables.pending_intents[0].resolution, 'denied');
  assert.match(enviados[0].text, /^❌ .*Infiltração teto banheiro — Campo Grande.*Luciano Alf: orcamento alto/);
  assert.deepStrictEqual(historico.map((h) => h.id), [RAFINHA.id]);
  assert.match(r.reply, /rejeitada/);
});

test('decidido por outro caminho (app): não mexe na tarefa, não avisa ninguém, fecha a pendência', async () => {
  const c = cenario();
  await abrirAprovacaoDeTarefa(c.deps, { task: TAREFA_REAL, solicitante: RAFINHA });
  c.enviados.length = 0;
  c.supabase.tables.tasks[0].status = 'done';
  const [intent] = await approvals.listOpenApprovals(c.supabase, LUCIANO.id);
  const r = await decidirAprovacaoDeTarefa(c.deps, { intent, decisao: 'approve', aprovador: LUCIANO });
  assert.strictEqual(c.supabase.tables.tasks[0].status, 'done');
  assert.strictEqual(c.enviados.length, 0);
  assert.strictEqual(c.supabase.tables.pending_intents[0].resolution, 'superseded');
  assert.match(r.reply, /já não está aguardando aprovação/);
});

test('o funil de aprovação já entende o código APROV-XXXX (com e sem motivo)', () => {
  const { detectApprovalReply } = require('../events/detect-approval-reply');
  assert.deepStrictEqual(
    (({ decision, token }) => ({ decision, token }))(detectApprovalReply('APROVA APROV-AB12')),
    { decision: 'approve', token: 'APROV-AB12' });
  const rj = detectApprovalReply('REJEITA APROV-AB12 orçamento alto');
  assert.strictEqual(rj.decision, 'reject');
  assert.strictEqual(rj.token, 'APROV-AB12');
  assert.strictEqual(rj.reason, 'orcamento alto');
});

// ── ligação (âncora de código) ────────────────────────────────────────────────────────────
test('engine: abre o pedido logo após criar awaiting_confirmation, decide pelo domínio task, diretor cria direto', () => {
  const fs = require('fs');
  const path = require('path');
  const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(engine, /if \(initialStatus === 'awaiting_confirmation' && taskId\) \{[\s\S]{0,600}abrirAprovacaoDeTarefa\(/);
  assert.match(engine, /it\.payload\.domain === 'task'\) \{[\s\S]{0,400}decidirAprovacaoDeTarefa\(/);
  assert.match(engine, /initialStatus = collaborator\.role === 'director' \? 'pending' : 'awaiting_confirmation'/);
});

test('engine: card que saiu conta como envio REAL pro SendHonesty (lição da manutenção, Rafinha 02/10)', () => {
  const fs = require('fs');
  const path = require('path');
  const engine = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.match(engine, /if \(_apRes && _apRes\.status === 'enviada'\) _pedidosAprovEnviados\+\+;/);
  assert.match(engine, /if \(pedidosAprovacaoEnviados\) _metrics\.envio_deterministico = \(_metrics\.envio_deterministico \|\| 0\) \+ pedidosAprovacaoEnviados;/);
});
