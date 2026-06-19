// src/services/finding-triage.js
// Auto-triagem dos findings da auditoria de conversa: casa com known-issues
// corrigidos e decide manter/suprimir/regressão. NÃO toca o status humano.
// Spec: docs/superpowers/specs/2026-06-19-precisao-auditoria-tom-design.md
'use strict';

const WINDOW_DAYS = 7;              // janela de atividade do relatório (last_seen)
const KI_LOOKBACK_DAYS = 45;       // recorte de known-issues corrigidos candidatos
const MATCH_MIN_CONFIDENCE = 0.7;  // abaixo disso, trata como "não casou"
const MARGIN_MS = 12 * 3600 * 1000; // borda de segurança na comparação temporal

/** Decide o destino de um finding casado com um known-issue. Pura: sem DB/LLM.
 * Ordem importa: regressão é avaliada ANTES de supressão (last_seen pós-fix vence). */
function decideTriage(finding, match, opts = {}) {
  const minConf = opts.minConfidence != null ? opts.minConfidence : MATCH_MIN_CONFIDENCE;
  const marginMs = opts.marginMs != null ? opts.marginMs : MARGIN_MS;

  if (!match || !match.codigo || (match.confidence || 0) < minConf) {
    return { decision: 'keep', matched_code: null, reason: 'sem casamento confiável' };
  }
  if (match.status !== 'corrigido' || !match.corrigido_em) {
    return { decision: 'keep', matched_code: match.codigo, reason: 'known-issue não está corrigido' };
  }
  const tFix = Date.parse(match.corrigido_em);
  const tLast = finding.last_seen ? Date.parse(finding.last_seen) : null;
  if (tLast != null && tLast > tFix) {
    return { decision: 'regression', matched_code: match.codigo, reason: 'reincidiu após corrigido_em (last_seen)' };
  }
  const hiconf = finding.incident_confidence === 'high';
  const tInc = finding.incident_at ? Date.parse(finding.incident_at) : null;
  if (hiconf && tInc != null && tInc > tFix) {
    return { decision: 'regression', matched_code: match.codigo, reason: 'incident_at posterior ao corrigido_em' };
  }
  if (hiconf && tInc != null && tInc < tFix - marginMs) {
    return { decision: 'suppress', matched_code: match.codigo, reason: 'já corrigido: incident_at anterior ao corrigido_em' };
  }
  return { decision: 'keep', matched_code: match.codigo, reason: 'tempo do incidente incerto/borda — mostra por segurança' };
}

/** Extrai o bloco {...} da saída do LLM e normaliza os matches. Nunca lança. */
function parseMatches(raw) {
  const s = String(raw == null ? '' : raw);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let obj;
  try { obj = JSON.parse(s.slice(start, end + 1)); } catch { return []; }
  const list = Array.isArray(obj && obj.matches) ? obj.matches : [];
  return list
    .filter(x => x && typeof x.finding_id === 'string')
    .map(x => ({
      finding_id: x.finding_id,
      matched_code: (x.matched_code && x.matched_code !== 'null') ? String(x.matched_code) : null,
      confidence: typeof x.confidence === 'number' ? x.confidence : 0,
      reason: typeof x.reason === 'string' ? x.reason.slice(0, 200) : '',
    }));
}

module.exports = {
  WINDOW_DAYS, KI_LOOKBACK_DAYS, MATCH_MIN_CONFIDENCE, MARGIN_MS,
  decideTriage, parseMatches,
};
