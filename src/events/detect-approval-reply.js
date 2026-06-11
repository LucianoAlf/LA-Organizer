'use strict';

// Fase F2 (APROVACAO-SEM-FUNIL, auditoria 09/06): o vocabulário de APROVAÇÃO ganha dono
// determinístico — espelha o padrão detect-rsvp-reply (função PURA; o engine decide com
// estado via approvals.listOpenApprovals). Caso real: "Aprovado" (resposta ao card do
// projeto) não casava o gate /^(APROVA|REJEITA)\b/ nem /^(aprov[oa]|rejeit[oa])$/ e caía
// no LLM, que completou um EVENTO. "sim/ok" NÃO entram aqui (pertencem a RSVP/intents).

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// O webhook reescreve reply-quote como:
//   [O usuário está RESPONDENDO a esta mensagem anterior...: "<quoted>"]\n<texto real>
// Detectores determinísticos precisam do texto REAL e do quoted SEPARADOS (regex
// ancorada não pode ver o scaffold — GAP 12 da auditoria).
function stripReplyScaffold(text) {
  const s = String(text || '');
  const m = s.match(/^\[O usu[áa]rio est[áa] RESPONDENDO a (?:esta mensagem anterior[^:]*: "([\s\S]*?)"|uma m[íi]dia anterior[^\]]*)\]\n?([\s\S]*)$/);
  if (m) return { userText: (m[2] || '').trim(), quotedText: m[1] || null };
  return { userText: s.trim(), quotedText: null };
}

// Palavras de enchimento que podem orbitar o verbo sem mudar o sentido.
// "nao" NUNCA é filler (negação muda tudo).
const FILLERS = new Set(['o', 'a', 'os', 'as', 'esse', 'essa', 'este', 'esta', 'isso', 'ai', 'la', 'ja', 'sim', 'agora', 'por', 'favor', 'pf', 'pfv', 'pra', 'para', 'mim', 'tom', 'tudo', 'pode', 'ta', 'que', 'qual', 'ne', 'meu', 'do', 'da', 'de']);

// BUG-10 (11/06): "Aprovo a ideia" extraía token=IDEIA e ativava funil de aprovação indevido.
// Substantivos genéricos não são tokens de aprovação; retornar null deixa o LLM tratar.
const GENERIC_WORDS = new Set([
  'ideia', 'ele', 'ela', 'eles', 'elas', 'coisa', 'jeito',
  'forma', 'modo', 'tipo', 'parte', 'ponto', 'tema', 'nome', 'valor',
  'hora', 'dia', 'vez', 'lado', 'base', 'prazo', 'plano', 'texto',
  'foto', 'video', 'aquilo', 'lance', 'negocio',
]);
const DOMAIN_WORDS = new Map([
  ['projeto', 'project'], ['projetos', 'project'],
  ['comunicado', 'announcement'], ['comunicados', 'announcement'],
]);
const BARE_APPROVE = new Set([
  'aprovado', 'aprovar', 'aprovo', 'aprova', 'aprovada',
  'pode aprovar', 'ta aprovado', 'aprovado sim', 'sim aprovado', 'aprova sim', 'esta aprovado',
]);
const BARE_REJECT = new Set([
  'rejeitado', 'rejeitar', 'rejeito', 'rejeita', 'reprovado', 'reprovo',
  'nao aprovo', 'nao aprova', 'nao aprovado',
]);

function domainHintOf(words) {
  for (const w of words) if (DOMAIN_WORDS.has(w)) return DOMAIN_WORDS.get(w);
  return null;
}

/**
 * @param {string} text mensagem do usuário (texto SEM o scaffold de reply — use stripReplyScaffold)
 * @returns {{decision:'approve'|'reject', token:string|null, reason:string|null, bare:boolean, domainHint:string|null}|null}
 */
function detectApprovalReply(text) {
  // Pergunta nunca é comando (lição EVENT-CONFAB: "rolou?" não conclui).
  if (/\?\s*$/.test(String(text || ''))) return null;
  const n = norm(text);
  if (!n) return null;
  const words = n.split(' ');
  if (words.length > 8) return null; // frase longa = conteúdo → LLM

  // 1) Forma BARE (mensagem é essencialmente só o verbo de aprovação)
  const noFiller = words.filter((w) => !FILLERS.has(w)).join(' ');
  if (BARE_APPROVE.has(n) || BARE_APPROVE.has(noFiller)) {
    return { decision: 'approve', token: null, reason: null, bare: true, domainHint: domainHintOf(words) };
  }
  if (BARE_REJECT.has(n) || BARE_REJECT.has(noFiller)) {
    return { decision: 'reject', token: null, reason: null, bare: true, domainHint: domainHintOf(words) };
  }

  // 2) Comando com token: (ok,)? aprova|rejeita <TOKEN> [motivo]
  //    "aprovei" (passado, relato) NÃO entra na alternação de propósito.
  const m = n.match(/^(?:ok |beleza |entao )?(aprovar?|aprovo|aprovado|rejeitar?|rejeito|rejeitado|reprovar?|reprovo)\s+(.+)$/);
  if (!m) return null;
  const decision = /^aprov/.test(m[1]) ? 'approve' : 'reject';
  let rest = m[2].split(' ').filter((w) => !FILLERS.has(w));
  // "aprova o projeto"/"aprovo o comunicado" → bare com hint de domínio
  if (rest.length && DOMAIN_WORDS.has(rest[0])) {
    const hint = DOMAIN_WORDS.get(rest[0]);
    const after = rest.slice(1);
    if (!after.length) return { decision, token: null, reason: null, bare: true, domainHint: hint };
    rest = after; // "aprova o projeto PROGRAMA" → token PROGRAMA
  }
  if (!rest.length) return { decision, token: null, reason: null, bare: true, domainHint: null };
  // BUG-10: substantivo genérico não é token de aprovação → null (LLM trata com contexto)
  if (GENERIC_WORDS.has(rest[0])) return null;
  const token = rest[0].toUpperCase();
  if (token.length < 3) return { decision, token: null, reason: null, bare: true, domainHint: null };
  // Motivo só faz sentido na rejeição (vai pro criador; norm tira acento — aceitável).
  const reason = decision === 'reject' ? (rest.slice(1).join(' ') || null) : null;
  return { decision, token, reason, bare: false, domainHint: null };
}

module.exports = { detectApprovalReply, stripReplyScaffold, _norm: norm };
