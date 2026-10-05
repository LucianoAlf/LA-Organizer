'use strict';
// src/services/aprovacao-tarefa-app.js — BOTAO-APROVAR-OPERACOES (05/10).
//
// O DEFEITO. Em web/src/screens/OperacaoDetalhe.tsx, tarefa awaiting_confirmation + diretor/coordenador
// mostrava "Aprovar" → status 'done'. Só que awaiting_confirmation tem DOIS sentidos:
//  (a) APROVAÇÃO PRA EXECUTAR — compra/obra de um request_type com requires_approval: a tarefa NASCE
//      aguardando (engine, applyTaskActions — AWAIT_APPROVAL) e nunca foi feita. Aprovar = 'pending'
//      (vai pra fila de execução) e quem pediu tem que saber. Marcar 'done' fechava compra que ninguém
//      comprou. As 15 tarefas da Rafinha paradas desde 30/05 são todas desse tipo.
//  (b) CONFIRMAÇÃO DE CONCLUSÃO — "Marcar pronto" no app (in_progress → awaiting_confirmation). Aqui
//      Aprovar → 'done' / Reabrir → 'in_progress' está certo e continua no app.
//
// O DISCRIMINADOR (nessa ordem):
//  1. pedido de aprovação ABERTO pra tarefa (pending_intents approval_pending, domain 'task') → (a);
//  2. trilha tasks_audit (trigger em toda mudança de status desde 23/05): a ÚLTIMA entrada em
//     awaiting_confirmation foi INSERT (nasceu aguardando) → (a); UPDATE (alguém marcou pronto) → (b).
//     Em 05/10 as 19 entradas em awaiting_confirmation da história eram todas INSERT — os 15 legados → (a);
//  3. sem trilha (tarefa anterior ao trigger ou leitura falhou): tipo com requires_approval → (a); senão (b).
//
// A DECISÃO no app passa pelo MESMO funil do WhatsApp (aprovacao-tarefa.decidirAprovacaoDeTarefa):
// guarda de corrida (só muda se AINDA awaiting_confirmation), fecha o APROV-XXXX, avisa quem pediu e
// grava no histórico dela. Legado sem pedido aberto ganha uma intent SINTÉTICA com o solicitante = quem
// criou (resolveApprovalByRef não acha nada pra fechar — inofensivo).
//
// PORTA: LOGIN da pessoa (Bearer JWT do Supabase) + papel director/coordinator, NUNCA o
// x-internal-secret (vai no bundle do navegador). Mesmo desenho do /internal/pix-painel.
// Dependências injetadas (nada de envio real em teste):
//   { usuarioDoToken, colaboradorPorEmail, lerTarefa, requerAprovacao(rtId), auditoria(taskId),
//     intentAberto(taskId), colaborador(id), decidir({ intent, decisao, motivo, aprovador }) }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAPEIS_QUE_APROVAM = new Set(['director', 'coordinator']);
const DECISOES = new Set(['approve', 'reject']);

function modoDaEspera({ status, intentAberto = null, auditoria = null, requerAprovacao = false }) {
  if (status !== 'awaiting_confirmation') return null;
  if (intentAberto) return 'aprovacao';
  const entradas = (Array.isArray(auditoria) ? auditoria : [])
    .filter((a) => a && a.new_status === 'awaiting_confirmation' && a.op !== 'DELETE')
    .sort((x, y) => String(x.changed_at || '').localeCompare(String(y.changed_at || '')));
  const ultima = entradas[entradas.length - 1];
  if (ultima) return ultima.op === 'INSERT' ? 'aprovacao' : 'conclusao';
  return requerAprovacao ? 'aprovacao' : 'conclusao';
}

async function _quem(token, deps) {
  if (!token) return { erro: { status: 401, body: { ok: false, error: 'no_auth' } } };
  const user = await Promise.resolve().then(() => deps.usuarioDoToken(token)).catch(() => null);
  if (!user || !user.email) return { erro: { status: 401, body: { ok: false, error: 'invalid_token' } } };
  const collab = await deps.colaboradorPorEmail(user.email);
  if (!collab) return { erro: { status: 403, body: { ok: false, error: 'no_collaborator' } } };
  return { collab };
}

async function _modoDaTarefa(task, deps) {
  if (task.status !== 'awaiting_confirmation') return { modo: null, intent: null };
  const intent = await Promise.resolve().then(() => deps.intentAberto(task.id)).catch(() => null);
  let auditoria = null;
  try { auditoria = await deps.auditoria(task.id); } catch (e) {
    console.warn(`[AprovacaoTarefaApp] trilha de auditoria fora task=${String(task.id).slice(0, 8)}: ${e.message}`);
  }
  let requer = false;
  if (task.request_type_id) {
    try { requer = !!(await deps.requerAprovacao(task.request_type_id)); } catch (_) { requer = false; }
  }
  return { modo: modoDaEspera({ status: task.status, intentAberto: intent, auditoria, requerAprovacao: requer }), intent };
}

// GET /internal/tarefa-aprovacao?task_id= → { ok, status, modo: 'aprovacao'|'conclusao'|null }
async function atenderModo({ token, taskId, deps }) {
  const q = await _quem(token, deps);
  if (q.erro) return q.erro;
  if (!taskId || !UUID_RE.test(taskId)) return { status: 400, body: { ok: false, error: 'task_id_invalido' } };
  const task = await deps.lerTarefa(taskId);
  if (!task) return { status: 404, body: { ok: false, error: 'tarefa_nao_encontrada' } };
  const { modo } = await _modoDaTarefa(task, deps);
  return { status: 200, body: { ok: true, status: task.status, modo } };
}

// POST /internal/tarefa-aprovacao/decidir { task_id, decisao: 'approve'|'reject', motivo? }
async function atenderDecisao({ token, taskId, decisao, motivo = null, deps }) {
  const q = await _quem(token, deps);
  if (q.erro) return q.erro;
  const aprovador = q.collab;
  if (!PAPEIS_QUE_APROVAM.has(aprovador.role)) return { status: 403, body: { ok: false, error: 'sem_permissao' } };
  if (!taskId || !UUID_RE.test(taskId)) return { status: 400, body: { ok: false, error: 'task_id_invalido' } };
  if (!DECISOES.has(decisao)) return { status: 400, body: { ok: false, error: 'decisao_invalida' } };
  const motivoLimpo = typeof motivo === 'string' && motivo.trim() ? motivo.trim().slice(0, 300) : null;

  const task = await deps.lerTarefa(taskId);
  if (!task) return { status: 404, body: { ok: false, error: 'tarefa_nao_encontrada' } };
  if (task.status !== 'awaiting_confirmation') return { status: 409, body: { ok: false, error: 'ja_decidida', status: task.status } };
  const { modo, intent: aberto } = await _modoDaTarefa(task, deps);
  if (modo !== 'aprovacao') return { status: 409, body: { ok: false, error: 'nao_e_aprovacao', status: task.status } };

  let intent = aberto;
  if (!intent) {
    const solicitante = task.created_by ? await Promise.resolve().then(() => deps.colaborador(task.created_by)).catch(() => null) : null;
    intent = {
      id: null,
      payload: {
        domain: 'task', ref_id: task.id, title: task.title || null,
        requester_id: (solicitante && solicitante.id) || task.created_by || null,
        requester_name: (solicitante && solicitante.full_name) || null,
        requester_phone: (solicitante && solicitante.phone) || null,
      },
    };
  }

  const r = await deps.decidir({ intent, decisao, motivo: motivoLimpo, aprovador });
  const depois = await deps.lerTarefa(taskId);
  const esperado = decisao === 'approve' ? 'pending' : 'cancelled';
  const statusAgora = depois ? depois.status : null;
  if (statusAgora !== esperado) {
    return { status: 409, body: { ok: false, error: 'ja_decidida', status: statusAgora, mensagem: r && r.reply } };
  }
  console.log(`[AprovacaoTarefaApp] ${decisao} task=${String(taskId).slice(0, 8)} por ${String(aprovador.id).slice(0, 8)} via app${aberto ? '' : ' (legado sem pedido)'} avisou=${!!(r && r.avisou)}`);
  return { status: 200, body: { ok: true, status: statusAgora, avisou: !!(r && r.avisou), mensagem: (r && r.reply) || null } };
}

module.exports = { modoDaEspera, atenderModo, atenderDecisao };
