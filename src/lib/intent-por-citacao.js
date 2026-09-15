'use strict';

// CLOSING-RITUAL-CLOBBERS-COORD (Dudu 14/09), segunda metade.
//
// Não basta a intent do recado sobreviver: com DUAS abertas, o engine escolhe o alvo por
// `openIntents.find(i => i.kind !== 'approval_pending')`, e `listOpenIntents` ordena por
// `asked_at DESC` — ou seja, a MAIS NOVA ganha. O Dudu respondeu "Isso" por reply-quote à
// pergunta do Rafinha e fechou o Fechamento do dia, que tinha nascido 12s antes.
//
// A citação é a intenção explícita do usuário e tem de vencer a recência. O precedente já
// existe em três lugares do engine (approval_pending por quotedText ~10145, pickDupBypassIntentForReply,
// pickEventDupMenu) — aqui é o mesmo mecanismo na porta que faltou.
//
// Fail-closed: na dúvida devolve null e o engine segue com o comportamento de hoje.

const MIN_CITACAO = 12;
const PREFIXO = 60;

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escolheIntentPorCitacao(abertas, quotedText) {
  const alvo = norm(quotedText);
  if (alvo.length < MIN_CITACAO || !Array.isArray(abertas)) return null;

  const casam = abertas.filter((i) => {
    if (!i || i.kind === 'approval_pending') return false;
    const q = norm(i.question_text);
    if (q.length < MIN_CITACAO) return false;
    return alvo.includes(q.slice(0, PREFIXO)) || q.includes(alvo.slice(0, PREFIXO));
  });

  return casam.length === 1 ? casam[0] : null;
}

module.exports = { escolheIntentPorCitacao };
