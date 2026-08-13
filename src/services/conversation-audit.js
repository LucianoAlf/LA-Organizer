// src/services/conversation-audit.js
// Auditoria de Qualidade de Conversa — detecta falhas REAIS do usuário com o TOM
// (confabulação, recusa indevida, mídia falha, pedido largado, frustração) a partir
// da conversa de 24h de cada pessoa. Acoplado ao Dream (03h, dispatcher.js).
// Alta precisão: lista vazia é o resultado normal. Dedupe por assinatura + contador.
// Funções recebem `sb` (supabase) e `chat` (provider) injetados → fáceis de testar.
'use strict';
const crypto = require('crypto');
const qaIsolation = require('./qa-isolation');

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

/** Extrai o bloco {...} da saída do LLM e valida cada finding. Nunca lança.
 * fallbackOccurredAt (AUDIT-NO-OCCURRED-AT, 12/06): quando o LLM não devolve occurred_at,
 * usa o timestamp da última msg da janela analisada como proxy — assim o achado tem QUANDO
 * aconteceu e a triagem pode comparar com corrigido_em dos known-issues (auto-supressão). */
function parseFindings(raw, fallbackOccurredAt = null) {
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
    occurred_at: f.occurred_at || fallbackOccurredAt || null,
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
  const rows = data || [];
  // lastAt: created_at da última msg da janela — vira fallback de occurred_at dos findings.
  const lastAt = rows.length ? rows[rows.length - 1].created_at : null;
  // AUDIT-RELATIVE-DATE-BLIND (02/08, caso Rafinha): o transcript ia SEM nenhuma marca de
  // tempo, então o auditor julgava "hoje/amanhã" contra o dia em que ELE roda (D+1), não
  // contra o dia da conversa. Sábado 01/08 o Rafinha disse "vai ser amanhã", o TOM reagendou
  // certo pra domingo 02/08 — e o auditor, rodando no domingo, acusou "TOM confirmou com a
  // data de hoje". Falso-positivo que vira alarme no relatório do dono. Prefixo [DD/MM (Dia)
  // HH:MM] por linha resolve e ainda dá noção de intervalo entre as falas.
  const _stamp = (iso) => {
    try {
      const f = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(iso));
      const g = (t) => (f.find((p) => p.type === t) || {}).value || '';
      return `${g('day')}/${g('month')} (${g('weekday').replace('.', '')}) ${g('hour')}:${g('minute')}`;
    } catch (_) { return ''; }
  };
  const text = rows
    .map(m => `[${_stamp(m.created_at)}] ${m.direction === 'inbound' ? 'USUÁRIO' : 'TOM'}: ${String(m.content || m.media_extracted_text || '').slice(0, 1600)}`)
    .join('\n')
    .slice(0, 24000);
  return { text, lastAt, sinceIso };
}

// ── AUDITORIA DE GRUPO (13/08/2026) ──────────────────────────────────────────────────
// AUDIT-GRUPO-CEGO: até aqui a auditoria lia SÓ `conversation_history`. Todo o trabalho de
// grupo — onde o financeiro vive — ficava fora de qualquer varredura. O caso Rose (10 tarefas
// concluídas erradas no grupo Financeiro em 12/08) nunca poderia ter aparecido no relatório:
// o sensor apontava pro outro lado. Não é falha do agente de governança, é falha do sensor.
//
// A régua é DELIBERADAMENTE a mesma do 1:1 (mesmo prompt, mesmo parseFindings, mesma
// severidade): inventar critério novo pra grupo criaria duas noções de "achado" e tornaria
// os números incomparáveis entre si.

/** Carimbo [DD/MM (dia) HH:MM] em BRT — compartilhado com o transcript 1:1. */
function _stampBrt(iso) {
  try {
    const f = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const g = (t) => (f.find((p) => p.type === t) || {}).value || '';
    return `${g('day')}/${g('month')} (${g('weekday').replace('.', '')}) ${g('hour')}:${g('minute')}`;
  } catch (_) { return ''; }
}

/**
 * Formata mensagens de grupo no mesmo shape do transcript 1:1, com UMA diferença que importa:
 * grupo tem várias pessoas, então cada fala precisa do NOME de quem falou. Sem isso o auditor
 * lê um diálogo embaralhado e erra a atribuição — falso positivo caro.
 *
 * Fala de membro sem `sender_id` (710 das 1633 no banco — GROUPCHAT-SENDER-ID-NULL) vira
 * "alguém do grupo" em vez de sumir: omitir a linha tiraria o PEDIDO do contexto e deixaria
 * o auditor vendo a resposta do TOM sem a pergunta que a gerou.
 *
 * Pura. @param {Array} rows @returns {string}
 */
function formatGroupTranscript(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((m) => {
      if (!m) return null;
      const quem = m.role === 'tom'
        ? 'TOM'
        : ((m.sender && (m.sender.preferred_name || m.sender.full_name)) || 'alguém do grupo');
      const txt = String(m.content || m.media_extracted_text || '').slice(0, 1600);
      if (!txt) return null;
      return `[${_stampBrt(m.created_at)}] ${quem}: ${txt}`;
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 24000);
}

/** Carrega a conversa de um GRUPO das últimas `hours`h, já formatada. */
async function loadGroupConversation(sb, groupId, hours = 24) {
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data } = await sb.from('group_chat_messages')
    .select('content, media_extracted_text, role, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(preferred_name, full_name)')
    .eq('group_id', groupId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(300);
  const rows = data || [];
  return { text: formatGroupTranscript(rows), lastAt: rows.length ? rows[rows.length - 1].created_at : null, sinceIso };
}

/** Analisa a conversa de um GRUPO. Retorna Finding[]. NUNCA lança. */
async function auditGroupConversation(sb, chat, group, hours = 24) {
  try {
    const { text: convo, lastAt } = await loadGroupConversation(sb, group.id, hours);
    if (convo.length < 80) return []; // conversa fina demais
    const { buildAuditMessages } = require('../prompts/conversation-audit-prompt');
    const { system, messages } = buildAuditMessages(convo);
    const r = await chat(system, messages, 1200);
    // `resolveIncidentAt` casa evidência contra `conversation_history` — inaplicável aqui.
    // Sem ele, occurred_at cai no lastAt da janela, que é o mesmo fallback do 1:1.
    return parseFindings(r && r.text, lastAt);
  } catch (err) {
    console.error(`[ConvAudit] erro no grupo ${group && group.name}:`, err.message);
    return [];
  }
}

/** Analisa a conversa de um colaborador. Retorna Finding[]. NUNCA lança. */
async function auditConversation(sb, chat, collaborator, hours = 24) {
  try {
    const { text: convo, lastAt, sinceIso } = await loadConversation(sb, collaborator.id, hours);
    if (convo.length < 80) return []; // conversa fina demais
    const { buildAuditMessages } = require('../prompts/conversation-audit-prompt');
    const { system, messages } = buildAuditMessages(convo);
    const r = await chat(system, messages, 1200);
    const findings = parseFindings(r && r.text, lastAt);
    for (const f of findings) {
      const inc = await resolveIncidentAt(sb, collaborator.id, f.evidence, f.occurred_at, sinceIso);
      f.incident_at = inc.incident_at;
      f.incident_confidence = inc.incident_confidence;
    }
    return findings;
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
// `opts.groupId` (13/08): achado de GRUPO. O sujeito passa a ser o grupo — quem chama
// normaliza pra `{id, full_name: group.name}`, porque o guard de QA lê `full_name` e o
// grupo do Replay Lab (`[QA] Financeiro Replay`) precisa cair fora das métricas igual aos
// perfis. `collaborator_id` fica nulo: o achado é do grupo, não de uma pessoa — atribuir a
// um membro seria inventar responsável.
async function upsertFinding(sb, collaborator, finding, opts = {}) {
  const _groupId = opts.groupId || null;
  try {
    // ---- Isolamento do Replay Lab (spec 05/08, fronteira das métricas) ----
    // Os cenários do laboratório geram exatamente os sintomas que este detector procura.
    // Sem este guard, cada bateria injeta falha FABRICADA em tom_audit_findings — e a
    // base que usamos para priorizar passaria a contar teste como incidente real.
    // Seria eu contaminando o próprio diagnóstico que orientou este trabalho.
    if (!qaIsolation.contaNasMetricas(collaborator)) {
      return 'ignorado_qa';
    }
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
      collaborator_id: _groupId ? null : collaborator.id,
      group_id: _groupId,
      category: finding.category,
      severity: finding.severity,
      summary: finding.summary,
      evidence: finding.evidence,
      occurred_at: finding.occurred_at,
      incident_at: finding.incident_at || null,
      incident_confidence: finding.incident_confidence || 'none',
      signature: sig,
      status: 'novo',
    });
    return 'inserted';
  } catch (err) {
    console.error('[ConvAudit] upsert err:', err.message);
    return 'error';
  }
}

/** Pega o trecho mais distintivo do evidence p/ ancorar na conversa.
 * Remove rótulos USUÁRIO:/TOM:, escolhe a linha mais longa, colapsa espaço, 100 chars. */
function pickProbe(evidence) {
  const lines = String(evidence == null ? '' : evidence)
    .split(/\n+/)
    .map(l => l.replace(/^\s*(USU[ÁA]RIO|TOM)\s*:\s*/i, '').replace(/\s+/g, ' ').trim())
    .filter(l => l.length >= 12);
  if (!lines.length) return '';
  return lines.sort((a, b) => b.length - a.length)[0].slice(0, 100).toLowerCase();
}

/** Tempo real do incidente: acha a mensagem da conversa que contém o trecho do
 * evidence e usa o created_at dela. Fallback: occurredAt (proxy de janela). */
async function resolveIncidentAt(sb, collaboratorId, evidence, occurredAt, sinceIso) {
  const probe = pickProbe(evidence);
  if (probe) {
    const { data } = await sb.from('conversation_history')
      .select('created_at, content, media_extracted_text')
      .eq('collaborator_id', collaboratorId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(60);
    const hit = (data || []).find(m => {
      const hay = `${m.content || ''} ${m.media_extracted_text || ''}`.toLowerCase();
      return hay.includes(probe);
    });
    if (hit) return { incident_at: hit.created_at, incident_confidence: 'high' };
  }
  if (occurredAt) return { incident_at: occurredAt, incident_confidence: 'low' };
  return { incident_at: null, incident_confidence: 'none' };
}

module.exports = {
  normalizeSummary, signatureFor, parseFindings, rankFindings,
  loadConversation, auditConversation, upsertFinding, resolveIncidentAt,
  formatGroupTranscript, loadGroupConversation, auditGroupConversation,
  CLOSED_STATUSES, SEV_RANK,
};
