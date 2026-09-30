'use strict';
// notificacao.js — NOTIFICATIONS-CALADA (30/09).
//
// RAIZ (medida em 30/09, pg_constraint): `notifications_notification_type_check` só aceita 11 tipos
// (deadline_alert, overdue_alert, deadline_extension_request, team_inactivity, project_at_risk,
// checkpoint_reminder, delegation_notice, emusys_reminder, checklist_reminder, broadcast_reminder,
// daily_task_reminder). O código grava mais três que NÃO estão lá — `task_reminder` (checkReminders),
// `silent_checkin` (check-in silencioso) e `task_assigned_by_other` (tarefa criada pra outra pessoa).
// O insert do PostgREST não lança: devolve `{ error }` (23514) e ninguém lia. 60 dias: 0 linhas
// desses três tipos contra 397 lembretes de hora e 37 tarefas atribuídas enviados de verdade.
// Quem LIA essas linhas ficou cego: o cooldown de 6h do checkReminders, a trava de 14 dias do
// check-in silencioso e o bloco "tarefas recém-atribuídas (1/2/3/4)" do contexto do TOM.
//
// Conserto sem schema: (1) toda gravação em `notifications` passa por registrarNotificacao, que LÊ
// o `error`, loga com tipo/onde/código e conta por tipo; (2) as três leituras passam a olhar o
// registro do que foi ENVIADO de fato — conversation_history (sendAndLink grava ref_type/ref_id).
// Schema que falta (migration, decisão do Alf): incluir os três tipos no CHECK — ver commit.

const _falhas = new Map();

async function registrarNotificacao(sb, row, { onde = '?' } = {}) {
  const tipo = (row && row.notification_type) || '?';
  let erro = null;
  try {
    const r = await sb.from('notifications').insert(row);
    erro = r && r.error ? r.error : null;
  } catch (e) { erro = { message: e.message, code: 'throw' }; }
  if (!erro) return { ok: true };
  _falhas.set(tipo, (_falhas.get(tipo) || 0) + 1);
  console.error(`[notifications] insert FALHOU tipo=${tipo} onde=${onde} code=${erro.code || '?'} (falhas deste tipo no processo: ${_falhas.get(tipo)}): ${String(erro.message || '').slice(0, 200)}`);
  return { ok: false, code: erro.code || null, erro: erro.message || String(erro) };
}

function falhasDeNotificacao() { return Object.fromEntries(_falhas); }
function _zeraFalhas() { _falhas.clear(); } // teste

// PostgREST trata `*` como curinga no like: o filtro exato do texto é feito aqui, em JS.
const LEMBRETE_DE_HORA_RE = /^(?:🔔|👉) \*Lembrete:\* /u;

/** O checkReminders já mandou o lembrete de hora desta tarefa desde `desdeIso`? (cooldown de 6h) */
async function jaAvisouLembreteDesde(sb, taskId, desdeIso) {
  const { data, error } = await sb.from('conversation_history').select('content, created_at')
    .eq('direction', 'outbound').eq('ref_type', 'task').eq('ref_id', taskId)
    .like('content', '%Lembrete:%').gte('created_at', desdeIso).limit(20);
  if (error) { console.error('[Reminders] cooldown (conversation_history) err:', error.message); return false; }
  return (data || []).some((r) => LEMBRETE_DE_HORA_RE.test(String(r.content || '')));
}

const CHECKIN_MARCA = 'Faz uns dias que a gente não conversa';
/** Já houve check-in silencioso pra esta pessoa desde `desdeIso`? (trava de 14 dias) */
async function jaFezCheckinDesde(sb, collabId, desdeIso) {
  const { data, error } = await sb.from('conversation_history').select('id')
    .eq('collaborator_id', collabId).eq('direction', 'outbound')
    .like('content', `%${CHECKIN_MARCA}%`).gte('created_at', desdeIso).limit(1);
  if (error) { console.error('[CheckinSilent] trava (conversation_history) err:', error.message); return true; } // na dúvida, não incomoda
  return Array.isArray(data) && data.length > 0;
}

const ATRIBUIDA_MARCA = 'abriu uma tarefa pra você';
/**
 * Envios de "📋 O <Fulano> abriu uma tarefa pra você:\n*<título>*" (conversation_history, ref_type=task)
 * viram as entradas `task_assigned_by_other` que o bloco de decisões pendentes lê. PURO.
 */
function atribuidasDoHistorico(rows) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && r.ref_id && String(r.content || '').includes(ATRIBUIDA_MARCA)).map((r) => {
    const c = String(r.content);
    const quem = (/O (.+?) abriu uma tarefa pra você/u.exec(c) || [])[1];
    const titulo = (/abriu uma tarefa pra você:\s*\*([^*\n]+)\*/u.exec(c) || [])[1];
    return {
      notification_type: 'task_assigned_by_other', reference_type: 'task', reference_id: r.ref_id,
      title: titulo ? `${titulo}${quem ? ` (de ${quem})` : ''}` : `Tarefa atribuída${quem ? ` por ${quem}` : ''}`,
      body: null, created_at: r.created_at, status: 'sent',
    };
  });
}
function juntaAtribuidas(notificacoes, rowsHistorico) {
  const base = Array.isArray(notificacoes) ? notificacoes : [];
  const ja = new Set(base.filter((n) => n.notification_type === 'task_assigned_by_other').map((n) => n.reference_id));
  return base.concat(atribuidasDoHistorico(rowsHistorico).filter((n) => !ja.has(n.reference_id)));
}

module.exports = { registrarNotificacao, falhasDeNotificacao, _zeraFalhas, jaAvisouLembreteDesde, jaFezCheckinDesde, atribuidasDoHistorico, juntaAtribuidas, LEMBRETE_DE_HORA_RE, CHECKIN_MARCA, ATRIBUIDA_MARCA };
