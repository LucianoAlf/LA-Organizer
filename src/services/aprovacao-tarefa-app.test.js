'use strict';
// BOTAO-APROVAR-OPERACOES (05/10). Em OperacaoDetalhe.tsx o botão "Aprovar" de uma tarefa
// awaiting_confirmation mandava SEMPRE pra 'done'. Só que awaiting_confirmation tem dois sentidos:
//  (a) APROVAÇÃO PRA EXECUTAR — compra/obra de tipo com requires_approval, nasceu aguardando
//      (INSERT direto em awaiting_confirmation). Aprovar = 'pending' (vai ser feita), nunca 'done'.
//      Caso real: as 15 tarefas da Rafinha (operacoes-tecnicas) paradas desde 30/05 —
//      c2a87b2f "Infiltração teto banheiro — Campo Grande", 547edde2 "Comprar 2 pads de estudo — Barra".
//      Aprovar no app as marcava CONCLUÍDAS sem ninguém executar, e quem pediu nunca sabia.
//  (b) CONFIRMAÇÃO DE CONCLUSÃO — "Marcar pronto" (in_progress → awaiting_confirmation, UPDATE).
//      Aqui Aprovar → 'done' está certo e continua.
// Nenhum envio real: decidir/enviar são injetados.
const test = require('node:test');
const assert = require('node:assert');
const { modoDaEspera, atenderModo, atenderDecisao } = require('./aprovacao-tarefa-app');

const TASK_ID = 'c2a87b2f-0000-4000-8000-000000000001';
const RAFINHA = { id: 'rafa-0000', full_name: 'Rafinha', phone: '5521900000001' };
const ALF = { id: 'alf-0000', role: 'director', full_name: 'Luciano Alf' };

// ── modoDaEspera ─────────────────────────────────────────────────────────────
test('modo: nasceu aguardando (INSERT) = aprovação pra executar, mesmo sem pedido aberto (legado)', () => {
  const auditoria = [{ op: 'INSERT', old_status: null, new_status: 'awaiting_confirmation', changed_at: '2026-10-03T15:13:00Z' }];
  assert.strictEqual(modoDaEspera({ status: 'awaiting_confirmation', intentAberto: null, auditoria, requerAprovacao: true }), 'aprovacao');
});

test('modo: chegou por UPDATE vindo de in_progress ("Marcar pronto") = confirmação de conclusão', () => {
  const auditoria = [
    { op: 'INSERT', old_status: null, new_status: 'awaiting_confirmation', changed_at: '2026-10-01T10:00:00Z' },
    { op: 'UPDATE', old_status: 'awaiting_confirmation', new_status: 'pending', changed_at: '2026-10-02T10:00:00Z' },
    { op: 'UPDATE', old_status: 'pending', new_status: 'in_progress', changed_at: '2026-10-03T10:00:00Z' },
    { op: 'UPDATE', old_status: 'in_progress', new_status: 'awaiting_confirmation', changed_at: '2026-10-04T10:00:00Z' },
  ];
  // tipo com requires_approval, aprovada, executada e marcada pronta: é CONCLUSÃO, não nova aprovação
  assert.strictEqual(modoDaEspera({ status: 'awaiting_confirmation', intentAberto: null, auditoria, requerAprovacao: true }), 'conclusao');
});

test('modo: pedido de aprovação ABERTO manda, qualquer que seja a trilha', () => {
  assert.strictEqual(modoDaEspera({ status: 'awaiting_confirmation', intentAberto: { id: 'i1' }, auditoria: [], requerAprovacao: false }), 'aprovacao');
});

test('modo: sem trilha de auditoria cai no tipo (requires_approval → aprovação; senão conclusão)', () => {
  assert.strictEqual(modoDaEspera({ status: 'awaiting_confirmation', intentAberto: null, auditoria: [], requerAprovacao: true }), 'aprovacao');
  assert.strictEqual(modoDaEspera({ status: 'awaiting_confirmation', intentAberto: null, auditoria: null, requerAprovacao: false }), 'conclusao');
});

test('modo: fora de awaiting_confirmation não há espera', () => {
  assert.strictEqual(modoDaEspera({ status: 'pending', intentAberto: null, auditoria: [], requerAprovacao: true }), null);
});

// ── deps fake ────────────────────────────────────────────────────────────────
function mkDeps(over = {}) {
  const chamadas = { decidir: [] };
  const estado = { task: { id: TASK_ID, title: 'Infiltração teto banheiro — Campo Grande', status: 'awaiting_confirmation', created_by: RAFINHA.id, request_type_id: 'rt-obra' } };
  const deps = {
    usuarioDoToken: async (t) => (t === 'jwt-ok' ? { email: 'alf@la' } : null),
    colaboradorPorEmail: async () => ALF,
    lerTarefa: async () => (estado.task ? { ...estado.task } : null),
    requerAprovacao: async () => true,
    auditoria: async () => [{ op: 'INSERT', old_status: null, new_status: 'awaiting_confirmation', changed_at: '2026-10-03T15:13:00Z' }],
    intentAberto: async () => null,
    colaborador: async (id) => (id === RAFINHA.id ? RAFINHA : null),
    decidir: async (args) => {
      chamadas.decidir.push(args);
      if (estado.task.status === 'awaiting_confirmation') estado.task.status = args.decisao === 'approve' ? 'pending' : 'cancelled';
      return { reply: 'ok', avisou: true };
    },
    ...over,
  };
  return { deps, chamadas, estado };
}

// ── atenderModo ──────────────────────────────────────────────────────────────
test('GET modo: sem login → 401; login ok → modo da espera', async () => {
  const { deps } = mkDeps();
  assert.strictEqual((await atenderModo({ token: null, taskId: TASK_ID, deps })).status, 401);
  assert.strictEqual((await atenderModo({ token: 'jwt-ruim', taskId: TASK_ID, deps })).status, 401);
  const r = await atenderModo({ token: 'jwt-ok', taskId: TASK_ID, deps });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.modo, 'aprovacao');
});

test('GET modo: task_id inválido → 400; inexistente → 404', async () => {
  const { deps, estado } = mkDeps();
  assert.strictEqual((await atenderModo({ token: 'jwt-ok', taskId: 'xx', deps })).status, 400);
  estado.task = null;
  assert.strictEqual((await atenderModo({ token: 'jwt-ok', taskId: TASK_ID, deps })).status, 404);
});

// ── atenderDecisao ───────────────────────────────────────────────────────────
test('POST decidir: só diretor/coordenador (porta = LOGIN, não o segredo do bundle)', async () => {
  const { deps, chamadas } = mkDeps({ colaboradorPorEmail: async () => ({ id: 'x', role: 'collaborator', full_name: 'Fulano' }) });
  assert.strictEqual((await atenderDecisao({ token: null, taskId: TASK_ID, decisao: 'approve', deps })).status, 401);
  const r = await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'approve', deps });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(chamadas.decidir.length, 0);
});

test('POST decidir: decisão inválida → 400', async () => {
  const { deps } = mkDeps();
  assert.strictEqual((await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'done', deps })).status, 400);
});

test('POST decidir: LEGADO sem pedido aberto → aprova pelo MESMO funil (pending) e avisa quem criou', async () => {
  const { deps, chamadas } = mkDeps();
  const r = await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'approve', deps });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.status, 'pending');
  assert.strictEqual(r.body.avisou, true);
  assert.strictEqual(chamadas.decidir.length, 1);
  const a = chamadas.decidir[0];
  assert.strictEqual(a.decisao, 'approve');
  assert.strictEqual(a.aprovador.id, ALF.id);
  // intent sintética com o solicitante = quem criou (pra decidirAprovacaoDeTarefa avisar e gravar no histórico)
  assert.strictEqual(a.intent.payload.ref_id, TASK_ID);
  assert.strictEqual(a.intent.payload.domain, 'task');
  assert.strictEqual(a.intent.payload.requester_id, RAFINHA.id);
  assert.strictEqual(a.intent.payload.requester_name, 'Rafinha');
  assert.strictEqual(a.intent.payload.requester_phone, RAFINHA.phone);
});

test('POST decidir: com pedido aberto usa a intent REAL (fecha o APROV-XXXX) e repassa o motivo', async () => {
  const intent = { id: 'int-1', collaborator_id: ALF.id, payload: { domain: 'task', ref_id: TASK_ID, token: 'APROV-AB12', requester_id: RAFINHA.id, requester_name: 'Rafinha', requester_phone: RAFINHA.phone } };
  const { deps, chamadas } = mkDeps({ intentAberto: async () => intent });
  const r = await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'reject', motivo: '  orçamento alto ', deps });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.status, 'cancelled');
  assert.strictEqual(chamadas.decidir[0].intent, intent);
  assert.strictEqual(chamadas.decidir[0].motivo, 'orçamento alto');
});

test('POST decidir: idempotente — 2º clique não decide de novo (409 ja_decidida)', async () => {
  const { deps, chamadas } = mkDeps();
  assert.strictEqual((await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'approve', deps })).status, 200);
  const r2 = await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'approve', deps });
  assert.strictEqual(r2.status, 409);
  assert.strictEqual(r2.body.error, 'ja_decidida');
  assert.strictEqual(r2.body.status, 'pending');
  assert.strictEqual(chamadas.decidir.length, 1);
});

test('POST decidir: corrida — outro caminho decidiu no meio (status não mudou pelo nosso) → 409', async () => {
  const { deps, estado } = mkDeps({
    decidir: async () => { estado.task.status = 'cancelled'; return { reply: 'já não está aguardando', avisou: false }; },
  });
  const r = await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'approve', deps });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'ja_decidida');
});

test('POST decidir: espera de CONCLUSÃO não passa por aqui (409 nao_e_aprovacao) — o app segue com done/Reabrir', async () => {
  const { deps, chamadas } = mkDeps({
    auditoria: async () => [{ op: 'UPDATE', old_status: 'in_progress', new_status: 'awaiting_confirmation', changed_at: '2026-10-04T10:00:00Z' }],
  });
  const r = await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'approve', deps });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.error, 'nao_e_aprovacao');
  assert.strictEqual(chamadas.decidir.length, 0);
});

test('POST decidir: falha da trilha de auditoria cai no tipo (não trava a decisão)', async () => {
  const { deps } = mkDeps({ auditoria: async () => { throw new Error('boom'); } });
  const r = await atenderDecisao({ token: 'jwt-ok', taskId: TASK_ID, decisao: 'approve', deps });
  assert.strictEqual(r.status, 200);
});
