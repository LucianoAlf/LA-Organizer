// src/utils/creation-claim.js
// Rede de honestidade pra criação de tarefa (PLANNING-CONFIRM-NO-CREATE, 22/06).
// Quando o TOM AFIRMA ter criado/anotado/organizado tarefa mas NENHUM marker de
// tarefa rodou no turno, o engine reescreve a resposta honesta (pede reconfirmação)
// em vez de deixar a mentira "criei" sair. NÃO auto-cria (anti-tarefa-fantasma,
// guard de 01/06). Decisão Alf 22/06: opção A. Irmão de FIN-FAKE-CONFIRM /
// AUDIT-OPTIMISTIC-CONFIRM / BATCH-COMPLETE-CONFIRM-NOOP.

// "Não consegui registrar" / a própria linha honesta NÃO são claim de criação.
const DECLINE_RE = /\bn[ãa]o\s+(?:consigo|consegui|d[áa]|deu|tem\s+como|rola|posso|cheguei\s+a)\b[^.!?]{0,40}\b(?:registr|anot|cri|adicion|salv|marc|guard|agend)/i;

const CLAIM_PATTERNS = [
  /\banotad[oa]\b/i,                                   // "Anotado!", "tarefa anotada"
  /\banotei\b/i,
  /\bregistr(?:ei|ad[oa])\b/i,
  /\bcri(?:ei|ad[oa])\b/i,                             // criei, criada, criado
  /\bagend(?:ei|ad[oa])\b/i,
  /\bmarquei\b/i,
  /\bdeixei\s+(?:anotad|marcad|agendad)/i,
  /\bcoloquei\s+(?:na|no)\s+(?:sua\s+)?(?:lista|agenda)\b/i,
  /\b(?:t[aá]|ficou)\s+na\s+sua\s+lista\b/i,
  /\borganizad[oa]\b/i,                                // "semana/agenda organizada"
  /\bte\s+cobro\b/i,                                   // "te cobro conforme for chegando"
];

function looksLikeCreationClaim(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (DECLINE_RE.test(s)) return false;
  return CLAIM_PATTERNS.some((re) => re.test(s));
}

function shouldHonestifyCreationClaim({ reply, taskMarkerFired, autoRetrySucceeded, awaitingConfirm, isInfoGathering } = {}) {
  if (!reply) return false;
  if (taskMarkerFired || autoRetrySucceeded || awaitingConfirm || isInfoGathering) return false;
  return looksLikeCreationClaim(reply);
}

const HONEST_LINE = '_⚠️ Na real, não cheguei a registrar isso aqui ainda — me confirma os itens (com o dia de cada um) que eu marco certinho agora._';

function honestifyCreationClaim(text, sanitizeOptimisticConfirm) {
  let base = String(text || '');
  if (typeof sanitizeOptimisticConfirm === 'function') {
    try { base = sanitizeOptimisticConfirm(base, 'failed') || ''; } catch (_) { /* mantém base */ }
  }
  base = String(base || '').trim();
  return base ? `${base}\n\n${HONEST_LINE}` : HONEST_LINE;
}

module.exports = { looksLikeCreationClaim, shouldHonestifyCreationClaim, honestifyCreationClaim };
