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
// Status "fechados": um finding triado como um destes NUNCA deve re-surgir como novo.
const CLOSED_STATUSES = new Set(['resolvido', 'falso_positivo', 'wontfix', 'corrigido']);
const SEV_RANK = { alto: 0, medio: 1, baixo: 2 };

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
    .select('content, media_extracted_text, direction, created_at')
    .eq('collaborator_id', collaboratorId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(300);
  // Slice por mensagem subiu 600→1600: o corte em 600 cortava áudios longos no meio
  // e o auditor lia o corte como "áudio do usuário foi cortado" → FALSO POSITIVO de
  // confabulação (caso Fabi 08/06). Inclui transcrição de mídia como fallback.
  return (data || [])
    .map(m => `${m.direction === 'inbound' ? 'USUÁRIO' : 'TOM'}: ${String(m.content || m.media_extracted_text || '').slice(0, 1600)}`)
    .join('\n')
    .slice(0, 24000);
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

/**
 * Ordena findings por severidade (alto→baixo) e ocorrências, e amostra com
 * DIVERSIDADE: até `perPerson` por colaborador na 1ª passada, depois preenche
 * até `max` com os mais graves restantes. Pura — não toca DB. Evita o relatório
 * ser dominado por 1 pessoa (caso 08/06: 5 amostras todas do mesmo chat).
 * @param {Array} findings linhas {severity, occurrences, collaborator_id, ...}
 * @param {{perPerson?:number, max?:number}} [opts]
 * @returns {{sample:Array, byPerson:Object, bySeverity:Object}}
 */
function rankFindings(findings, opts = {}) {
  const perPerson = opts.perPerson != null ? opts.perPerson : 2;
  const max = opts.max != null ? opts.max : 7;
  const sevOf = f => (f && SEV_RANK[f.severity] != null) ? f.severity : 'medio';
  const list = (Array.isArray(findings) ? findings.slice() : []).sort((a, b) => {
    const d = SEV_RANK[sevOf(a)] - SEV_RANK[sevOf(b)];
    return d !== 0 ? d : (b.occurrences || 1) - (a.occurrences || 1);
  });
  const byPerson = {};
  const bySeverity = {};
  for (const f of list) {
    bySeverity[sevOf(f)] = (bySeverity[sevOf(f)] || 0) + 1;
    const pid = (f && f.collaborator_id) || 'unknown';
    byPerson[pid] = (byPerson[pid] || 0) + 1;
  }
  const seen = {};
  const sample = [];
  for (const f of list) {              // 1ª passada: diversifica (teto por pessoa)
    if (sample.length >= max) break;
    const pid = (f && f.collaborator_id) || 'unknown';
    if ((seen[pid] || 0) >= perPerson) continue;
    seen[pid] = (seen[pid] || 0) + 1;
    sample.push(f);
  }
  for (const f of list) {              // 2ª passada: preenche até max com os mais graves
    if (sample.length >= max) break;
    if (!sample.includes(f)) sample.push(f);
  }
  return { sample, byPerson, bySeverity };
}

/** Grava 1 finding com dedupe por assinatura. Triado/fechado NÃO re-surge. NUNCA lança. */
async function upsertFinding(sb, collaborator, finding) {
  try {
    const sig = signatureFor(finding.category, collaborator.id, finding.summary);
    const { data: rows } = await sb.from('tom_audit_findings')
      .select('id, occurrences, status')
      .eq('signature', sig);
    const all = rows || [];
    // Já triado como fechado (resolvido/falso_positivo/...) → NÃO re-surge: só
    // registra a reincidência no last_seen e mantém o status fechado.
    const closed = all.find(r => CLOSED_STATUSES.has(r.status));
    if (closed) {
      await sb.from('tom_audit_findings')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', closed.id);
      return 'suppressed_closed';
    }
    // Já aberto (novo/confirmado) → incrementa ocorrências.
    const open = all.find(r => r.status === 'novo' || r.status === 'confirmado');
    if (open) {
      await sb.from('tom_audit_findings')
        .update({ occurrences: (open.occurrences || 1) + 1, last_seen: new Date().toISOString() })
        .eq('id', open.id);
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
  normalizeSummary, signatureFor, parseFindings, rankFindings,
  loadConversation, auditConversation, upsertFinding,
  CLOSED_STATUSES, SEV_RANK,
};
