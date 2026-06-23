// src/services/finding-triage.js
// Auto-triagem dos findings da auditoria de conversa: casa com known-issues
// corrigidos e decide manter/suprimir/regressão. NÃO toca o status humano.
// Spec: docs/superpowers/specs/2026-06-19-precisao-auditoria-tom-design.md
'use strict';

const WINDOW_DAYS = 7;              // janela de atividade do relatório (last_seen)
const KI_LOOKBACK_DAYS = 45;       // recorte de known-issues corrigidos candidatos
const MATCH_MIN_CONFIDENCE = 0.7;  // abaixo disso, trata como "não casou"
const MARGIN_MS = 12 * 3600 * 1000; // borda de segurança na comparação temporal
const KI_MAX = 40;          // teto de known-issues candidatos (corrigidos mais recentes) — fix antigo não casa com finding ativo; evita prompt gigante (spawn E2BIG no CLI)
const BATCH_FINDINGS = 20;  // findings por chamada ao LLM — prompt pequeno + resposta cabe em maxTokens

/** Decide o destino de um finding casado com um known-issue. Pura: sem DB/LLM.
 * A hora REAL do incidente (incident_at, evidence-anchored) MANDA quando confiável.
 * last_seen é hora de DETECÇÃO, não de ocorrência: um achado detectado de manhã cujo
 * incidente foi na noite anterior — antes de um fix de madrugada — é CAUDA, não regressão
 * (bug AUDIT-REGRESSION-LASTSEEN, caso 23/06: COORD/SYNC/INSTALLMENTS). last_seen só
 * decide no fallback (quando não temos incident_at confiável). */
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
  const hiconf = finding.incident_confidence === 'high';
  const tInc = finding.incident_at ? Date.parse(finding.incident_at) : null;

  // Caminho confiável: a hora real do incidente decide (não a hora da detecção).
  if (hiconf && tInc != null) {
    if (tInc > tFix + marginMs) {
      return { decision: 'regression', matched_code: match.codigo, reason: 'incident_at posterior ao corrigido_em' };
    }
    if (tInc < tFix) {
      return { decision: 'suppress', matched_code: match.codigo, reason: 'já corrigido: incident_at anterior ao corrigido_em' };
    }
    // [tFix, tFix+margem]: incidente logo após o fix — lag de deploy ou regressão de borda. Mostra.
    return { decision: 'keep', matched_code: match.codigo, reason: 'incidente logo após o fix — mostra por segurança' };
  }

  // Fallback (sem incident_at confiável): last_seen (detecção) bem após o fix sinaliza reincidência.
  const tLast = finding.last_seen ? Date.parse(finding.last_seen) : null;
  if (tLast != null && tLast > tFix + marginMs) {
    return { decision: 'regression', matched_code: match.codigo, reason: 'reincidiu após corrigido_em (last_seen, sem incident_at)' };
  }
  return { decision: 'keep', matched_code: match.codigo, reason: 'tempo do incidente incerto — mostra por segurança' };
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

const { buildMatchMessages } = require('../prompts/finding-triage-prompt');

function isoDaysAgo(nowIso, days) {
  return new Date(Date.parse(nowIso) - days * 86400 * 1000).toISOString();
}

/** Casa os findings da janela com known-issues corrigidos e grava auto_triage.
 * sb/chat injetados. NUNCA lança (degrada para no-op). Retorna sumário. */
async function triageOpenFindings(sb, chat, opts = {}) {
  const out = { decided: 0, suppressed: 0, regressions: 0, kept: 0 };
  try {
    const nowIso = opts.nowIso || new Date().toISOString();
    const windowIso = isoDaysAgo(nowIso, opts.windowDays || WINDOW_DAYS);
    const kiSinceIso = isoDaysAgo(nowIso, opts.kiLookbackDays || KI_LOOKBACK_DAYS);

    const { data: findings } = await sb.from('tom_audit_findings')
      .select('id, category, summary, evidence, incident_at, incident_confidence, last_seen')
      .in('status', ['novo', 'confirmado'])
      .gte('last_seen', windowIso);
    const open = findings || [];
    if (!open.length) return out;

    // Known-issues corrigidos: mais recentes primeiro, teto KI_MAX. Fix antigo raramente
    // casa com finding ainda ativo, e mandar TODOS (centenas) estourava o arg do CLI (E2BIG).
    const { data: kis } = await sb.from('tom_known_issues')
      .select('codigo, titulo, area, causa_raiz, status, corrigido_em')
      .eq('status', 'corrigido')
      .gte('corrigido_em', kiSinceIso)
      .order('corrigido_em', { ascending: false })
      .limit(opts.kiMax || KI_MAX);
    const known = kis || [];
    const byCode = {};
    for (const k of known) byCode[k.codigo] = k;

    // Casa em LOTES de findings → prompt pequeno por chamada (sem E2BIG) e resposta curta.
    const matchById = {};
    if (known.length) {
      const batch = opts.batchFindings || BATCH_FINDINGS;
      for (let i = 0; i < open.length; i += batch) {
        const { system, messages } = buildMatchMessages(open.slice(i, i + batch), known);
        const r = await chat(system, messages, 1500);
        for (const mm of parseMatches(r && r.text)) matchById[mm.finding_id] = mm;
      }
    }

    for (const f of open) {
      const mm = matchById[f.id];
      const ki = mm && mm.matched_code ? byCode[mm.matched_code] : null;
      const match = ki ? { ...ki, confidence: mm.confidence } : null;
      const verdict = decideTriage(f, match, opts);
      const auto_triage = {
        decision: verdict.decision,
        matched_code: verdict.matched_code,
        match_confidence: mm ? mm.confidence : null,
        reason: verdict.reason,
        decided_at: nowIso,
      };
      await sb.from('tom_audit_findings').update({ auto_triage }).eq('id', f.id);
      out.decided++;
      if (verdict.decision === 'suppress') out.suppressed++;
      else if (verdict.decision === 'regression') out.regressions++;
      else out.kept++;
    }
  } catch (err) {
    console.error('[FindingTriage] erro:', err.message);
  }
  return out;
}

module.exports = {
  WINDOW_DAYS, KI_LOOKBACK_DAYS, MATCH_MIN_CONFIDENCE, MARGIN_MS, KI_MAX, BATCH_FINDINGS,
  decideTriage, parseMatches, triageOpenFindings,
};
