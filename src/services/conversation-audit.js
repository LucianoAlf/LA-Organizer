// src/services/conversation-audit.js
// Auditoria de Qualidade de Conversa — detecta falhas REAIS do usuário com o TOM
// (confabulação, recusa indevida, mídia falha, pedido largado, frustração) a partir
// da conversa de 24h de cada pessoa. Acoplado ao Dream (03h, dispatcher.js).
// Alta precisão: lista vazia é o resultado normal. Dedupe por assinatura + contador.
// Funções recebem `sb` (supabase) e `chat` (provider) injetados → fáceis de testar.
'use strict';
const crypto = require('crypto');

const VALID_CATEGORIES = new Set([
  'confabulation', 'wrong_refusal', 'media_fail', 'dropped_request', 'frustration',
  'proactive_overreach',
]);
const VALID_SEVERITY = new Set(['alto', 'medio', 'baixo']);

/** Normaliza o resumo pra assinatura: sem acento/pontuação/número, minúsculo, colapsado, 60 chars. */
function normalizeSummary(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Assinatura de dedupe: categoria + colaborador + resumo normalizado. */
function signatureFor(category, collaboratorId, summary) {
  return crypto.createHash('sha1')
    .update(`${category}:${collaboratorId}:${normalizeSummary(summary)}`)
    .digest('hex');
}

/** Extrai o bloco {...} da saída do LLM e valida cada finding. Nunca lança. */
function parseFindings(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return []; }
  const list = Array.isArray(obj && obj.findings) ? obj.findings : [];
  return list.filter(f =>
    f && VALID_CATEGORIES.has(f.category) &&
    typeof f.evidence === 'string' && f.evidence.trim().length > 0 &&
    typeof f.summary === 'string' && f.summary.trim().length > 0,
  ).map(f => ({
    category: f.category,
    severity: VALID_SEVERITY.has(f.severity) ? f.severity : 'medio',
    summary: String(f.summary).slice(0, 200),
    evidence: String(f.evidence).slice(0, 1000),
    occurred_at: f.occurred_at || null,
  }));
}

/** Carrega a conversa (AMBAS direções) das últimas `hours`h e formata em texto. */
async function loadConversation(sb, collaboratorId, hours = 24) {
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data } = await sb.from('conversation_history')
    .select('content, direction, created_at')
    .eq('collaborator_id', collaboratorId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(300);
  return (data || [])
    .map(m => `${m.direction === 'inbound' ? 'USUÁRIO' : 'TOM'}: ${String(m.content || '').slice(0, 600)}`)
    .join('\n')
    .slice(0, 14000);
}

/** Analisa a conversa de um colaborador. Retorna Finding[]. NUNCA lança. */
async function auditConversation(sb, chat, collaborator, hours = 24) {
  try {
    const convo = await loadConversation(sb, collaborator.id, hours);
    if (convo.length < 80) return []; // conversa fina demais
    const { buildAuditMessages } = require('../prompts/conversation-audit-prompt');
    const { system, messages } = buildAuditMessages(convo);
    const r = await chat(system, messages, 1200);
    return parseFindings(r && r.text);
  } catch (err) {
    console.error(`[ConvAudit] erro p/ ${collaborator.full_name}:`, err.message);
    return [];
  }
}

/** Grava 1 finding com dedupe por assinatura (open = novo/confirmado). NUNCA lança. */
async function upsertFinding(sb, collaborator, finding) {
  try {
    const sig = signatureFor(finding.category, collaborator.id, finding.summary);
    const { data: existing } = await sb.from('tom_audit_findings')
      .select('id, occurrences')
      .eq('signature', sig)
      .in('status', ['novo', 'confirmado'])
      .limit(1);
    if (existing && existing.length > 0) {
      await sb.from('tom_audit_findings')
        .update({ occurrences: (existing[0].occurrences || 1) + 1, last_seen: new Date().toISOString() })
        .eq('id', existing[0].id);
      return 'incremented';
    }
    await sb.from('tom_audit_findings').insert({
      collaborator_id: collaborator.id,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      evidence: finding.evidence,
      occurred_at: finding.occurred_at,
      signature: sig,
      status: 'novo',
    });
    return 'inserted';
  } catch (err) {
    console.error('[ConvAudit] upsert err:', err.message);
    return 'error';
  }
}

module.exports = {
  normalizeSummary, signatureFor, parseFindings,
  loadConversation, auditConversation, upsertFinding,
};
