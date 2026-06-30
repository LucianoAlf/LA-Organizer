'use strict';
// KRISSYA/PETERSON família — executor DETERMINÍSTICO do fechar/cancelar projeto.
// Chamado no "sim" do usuário (NUNCA por marker do LLM). Autoridade já garantida no
// gate de confirmação (a intent só foi aberta pra quem podia) e carregada pela posse
// da intent — aqui só re-checamos idempotência/corrida. KRISSYA-PROJECT-CLOSE-NO-HANDLER.
const supabase = require('../supabase/client');
const { ALIVE_STATUSES } = require('../lib/project-status');

async function applyProjectStatusChange(collab, opts) {
  const { projectId, newStatus } = opts || {};
  if (!collab || !projectId || !newStatus) return { ok: false, reason: 'bad_args' };
  if (newStatus !== 'completed' && newStatus !== 'cancelled') return { ok: false, reason: 'bad_status' };

  // 1) lê estado atual (idempotência contra "sim" duplo / corrida)
  const { data: proj, error: readErr } = await supabase
    .from('projects')
    .select('id, name, status, created_by')
    .eq('id', projectId)
    .single();
  if (readErr || !proj) return { ok: false, reason: 'not_found' };
  if (!ALIVE_STATUSES.has(proj.status)) return { ok: false, reason: 'already_closed', project: proj };

  // 2) update com guarda de corrida (.in status vivo): só muda se ainda estava vivo
  const { data: upd, error: updErr } = await supabase
    .from('projects')
    .update({ status: newStatus })
    .eq('id', projectId)
    .in('status', [...ALIVE_STATUSES])
    .select('id');
  if (updErr) return { ok: false, reason: `persist_error:${updErr.message}`, project: proj };
  if (!upd || !upd.length) return { ok: false, reason: 'already_closed', project: proj };

  console.log(`[ProjectStatus] ${String(collab.id).slice(0, 8)} -> ${proj.name} = ${newStatus}`);
  return { ok: true, project: { ...proj, status: newStatus } };
}

module.exports = { applyProjectStatusChange };
