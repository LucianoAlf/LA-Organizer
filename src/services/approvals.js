// src/services/approvals.js — Fase F1 do plano "resposta curta cai na pendência errada"
// (known issue APROVACAO-SEM-FUNIL, auditoria 09/06). Pedido de aprovação vira ESTADO
// consultável: cada card enviado abre uma pending_intent kind=approval_pending NO NOME
// DO APROVADOR. O intercept determinístico (engine + detect-approval-reply) e o prompt
// leem daqui. supabase é INJETADO (padrão dos services novos — local diverge da VPS).

'use strict';

const KIND = 'approval_pending';
const APPROVAL_EXPIRY_DAYS = 7; // aprovação vive mais que intents comuns (24h); cron 6h cobra

// Supersede SÓ do mesmo ref (re-envio do card re-abre/re-fresca a mesma pendência).
// NUNCA por kind inteiro: projeto e comunicado podem estar pendentes JUNTOS
// (caso real 09/06) e um não pode matar o outro.
async function openApproval(supabase, { approverId, domain, refId, token = null, shortId = null }) {
  if (!approverId || !domain || !refId) return null;
  try {
    await supabase.from('pending_intents')
      .update({ resolved_at: new Date().toISOString(), resolution: 'superseded', resolution_note: 'card reenviado (mesmo ref)' })
      .eq('collaborator_id', approverId)
      .eq('kind', KIND)
      .is('resolved_at', null)
      .eq('payload->>ref_id', refId);
  } catch (e) { console.warn('[Approvals] supersede err:', e.message); }

  const question = domain === 'project'
    ? `Projeto aguardando sua aprovação — responda APROVA ${token || '<token>'}`
    : `Comunicado aguardando sua aprovação — responda APROVAR ${shortId || ''}`.trim();
  const { data, error } = await supabase.from('pending_intents')
    .insert({
      collaborator_id: approverId,
      kind: KIND,
      payload: { domain, ref_id: refId, token, short_id: shortId },
      question_text: question.slice(0, 1000),
    })
    .select('id').single();
  if (error) { console.error('[Approvals] open err:', error.message); return null; }
  console.log(`[Approvals] opened ${domain} ${String(refId).slice(0, 8)} for ${String(approverId).slice(0, 8)}`);
  return data.id;
}

function openProjectApproval(supabase, { approverId, projectId, token }) {
  return openApproval(supabase, { approverId, domain: 'project', refId: projectId, token });
}

function openAnnouncementApproval(supabase, { approverId, announcementId, shortId }) {
  return openApproval(supabase, { approverId, domain: 'announcement', refId: announcementId, shortId });
}

// Aprovações ABERTAS do colaborador (janela própria de 7 dias), mais recente primeiro.
async function listOpenApprovals(supabase, collaboratorId) {
  if (!collaboratorId) return [];
  const cutoff = new Date(Date.now() - APPROVAL_EXPIRY_DAYS * 864e5).toISOString();
  const { data, error } = await supabase.from('pending_intents')
    .select('id, payload, question_text, asked_at')
    .eq('collaborator_id', collaboratorId)
    .eq('kind', KIND)
    .is('resolved_at', null)
    .gte('asked_at', cutoff)
    .order('asked_at', { ascending: false })
    .limit(10);
  if (error) { console.warn('[Approvals] list err:', error.message); return []; }
  return (data || []).filter((i) => i.payload && i.payload.ref_id);
}

// Fecha TODAS as intents abertas daquele ref (qualquer aprovador notificado) quando a
// aprovação/rejeição EXECUTA — por qualquer caminho (WhatsApp, intercept, PWA futuro).
async function resolveApprovalByRef(supabase, refId, resolution, note = null) {
  if (!refId) return 0;
  const { data, error } = await supabase.from('pending_intents')
    .update({
      resolved_at: new Date().toISOString(),
      resolution,
      resolution_note: note ? String(note).slice(0, 500) : null,
    })
    .eq('kind', KIND)
    .is('resolved_at', null)
    .eq('payload->>ref_id', refId)
    .select('id');
  if (error) { console.warn('[Approvals] resolve err:', error.message); return 0; }
  const n = (data || []).length;
  if (n) console.log(`[Approvals] resolved ${n} intent(s) for ref ${String(refId).slice(0, 8)} as ${resolution}`);
  return n;
}

// F4 (GOV-APROVADOR-DIVERGENTE): aprovador = LÍDER de quem criou, pela MATRIZ de
// governança (resolveLeadersOf: unidade→gerente, grupo→governance_leaders, arestas N:N,
// fallback CEO). Substitui as cascatas legadas que divergiam entre si (internal-api:
// supervisor_id→director ALFABÉTICO; dispatcher: supervisor_id→is_ceo) e que só
// acertavam o Alf por dado legado. Retorna o aprovador PRIMÁRIO (1º líder com phone).
async function resolveApproverFor(supabase, creatorId) {
  if (!creatorId) return null;
  const { loadCollabsWithEdges } = require('./governance-edges');
  const { resolveLeadersOf } = require('./leader-routing');
  const all = await loadCollabsWithEdges(supabase);
  const creator = all.find((c) => c.id === creatorId);
  if (!creator) return null;
  const leaders = resolveLeadersOf(creator, all).filter((l) => l.phone);
  const approver = leaders[0] || null;
  if (approver) console.log(`[Approvals] approver resolved: ${approver.full_name} for creator ${creator.full_name} (matriz)`);
  else console.warn(`[Approvals] nenhum aprovador com phone para ${creator.full_name}`);
  return approver;
}

module.exports = { openProjectApproval, openAnnouncementApproval, listOpenApprovals, resolveApprovalByRef, resolveApproverFor, APPROVAL_EXPIRY_DAYS };
