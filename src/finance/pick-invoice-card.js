'use strict';
// Escolhe o cartão-alvo do commit de uma fatura importada, SEM chutar. Bug Rose 14/07 22:08:
// o commit fazia findCard(emissor="Itaú") — que casa 3 cartões dela (Itaú Matheus, Itaú Rose,
// Latam PASS que também é Itaú) — e pegava o [0] silenciosamente → lançou 59 itens no cartão
// ERRADO (Itaú Matheus). Regra: na dúvida de cartão, NÃO lança — pergunta. E a FALA do usuário
// ("essa fatura é do LATAM PASS") vence o emissor do PDF, porque o nome do cartão dela pode nem
// conter o emissor (Latam PASS não tem "Itaú" no nome — só a fala resolve).
//
// PURO (sem I/O). Retorna:
//   { status:'resolved', card, via }            — 1 cartão certo
//   { status:'ambiguous', candidates }          — >1 casou; perguntar qual
//   { status:'notfound', candidates: allCards } — 0 casou; perguntar qual

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bcart[aã]o\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// O nome do cartão aparece no texto? (string contígua OU todos os tokens significativos presentes)
function _mentions(text, cardNorm) {
  if (!cardNorm) return false;
  if (text.includes(cardNorm)) return true;
  const toks = cardNorm.split(' ').filter((t) => t.length >= 3);
  return toks.length > 0 && toks.every((t) => new RegExp(`\\b${t}\\b`).test(text));
}

function pickInvoiceCard({ emissor, userText, cards, cardIdHint } = {}) {
  const list = (cards || []).map((c) => ({ ...c, _n: _norm(c.name) }));
  if (!list.length) return { status: 'notfound', candidates: [] };

  // 1) card_id já confirmado numa desambiguação anterior
  if (cardIdHint) {
    const byId = list.find((c) => c.id === cardIdHint);
    if (byId) return { status: 'resolved', card: byId, via: 'id' };
  }

  // 2) a FALA do usuário nomeia o cartão (vence o emissor do PDF)
  const ut = _norm(userText);
  if (ut) {
    const named = list.filter((c) => _mentions(ut, c._n));
    if (named.length === 1) return { status: 'resolved', card: named[0], via: 'user' };
    if (named.length > 1) return { status: 'ambiguous', candidates: named, via: 'user' };
  }

  // 3) emissor do PDF
  const em = _norm(emissor);
  if (em) {
    const byEm = list.filter((c) => c._n && (c._n.includes(em) || em.includes(c._n)));
    if (byEm.length === 1) return { status: 'resolved', card: byEm[0], via: 'emissor' };
    if (byEm.length > 1) return { status: 'ambiguous', candidates: byEm, via: 'emissor' };
  }

  return { status: 'notfound', candidates: list };
}

module.exports = { pickInvoiceCard };
