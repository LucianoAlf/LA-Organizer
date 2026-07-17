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

  const hinted = cardIdHint ? list.find((c) => c.id === cardIdHint) : null;

  // 1) a FALA do usuário nomeia o cartão — vence o emissor do PDF E o cardIdHint.
  // Rose 16/07 01:57: o hint valia mais que a fala, e o hint era um CHUTE (o Intercept A
  // gravava findCard(emissor)[0] na intent sem desambiguar). Ela corrigiu "é o cartão LATAM
  // PASS", o hint chutado (Itaú Matheus) ganhou e 58 itens foram pro cartão errado. A fala é
  // a intenção real e é a mais recente: manda nela.
  const ut = _norm(userText);
  if (ut) {
    const named = list.filter((c) => _mentions(ut, c._n));
    if (named.length === 1) return { status: 'resolved', card: named[0], via: 'user' };
    if (named.length > 1) {
      // Fala ambígua ("cartão Itaú" casa 2): o hint desempata SÓ se for um dos citados.
      // Hint fora do que o usuário falou está contraditado por ele — aí pergunta.
      if (hinted && named.some((c) => c.id === hinted.id)) return { status: 'resolved', card: hinted, via: 'id' };
      return { status: 'ambiguous', candidates: named, via: 'user' };
    }
  }

  // 2) card_id da intent (a fala não nomeou cartão nenhum — ex.: "sim")
  if (hinted) return { status: 'resolved', card: hinted, via: 'id' };

  // 3) emissor do PDF
  const em = _norm(emissor);
  if (em) {
    const byEm = list.filter((c) => c._n && (c._n.includes(em) || em.includes(c._n)));
    if (byEm.length === 1) return { status: 'resolved', card: byEm[0], via: 'emissor' };
    if (byEm.length > 1) return { status: 'ambiguous', candidates: byEm, via: 'emissor' };
  }

  return { status: 'notfound', candidates: list };
}

// A fala do usuário deve RE-ESTAGIAR a prévia no cartão nomeado, em vez de commitar?
//
// Regra: NINGUÉM CONFIRMA UMA PRÉVIA QUE NÃO VIU. Quando a fala nomeia um cartão diferente
// do alvo atual da intent (inclusive quando ainda não há alvo), o usuário está DESAMBIGUANDO
// — ele nunca viu a prévia desse cartão, logo não pode ter confirmado ela.
//
// Rose 16/07 21:27: a mensagem de desambiguação promete "Responde tipo *lança no X* que eu te
// mando a prévia pra conferir", mas detectInvoiceReply("lança no X") == 'commit_financeiro' e
// o lançamento saía DIRETO, sem prévia. Ela digitou exatamente o que o TOM mandou digitar e
// levou o lançamento na cara — o TOM mentiu na própria instrução que deu.
//
// cancel e commit_anotacoes MANDAM (nunca viram re-estágio, mesmo nomeando cartão).
function shouldRestageCard({ decision, pick, currentCardId } = {}) {
  if (decision && decision !== 'commit_financeiro') return false;
  if (!pick || pick.status !== 'resolved' || pick.via !== 'user') return false;
  return pick.card.id !== (currentCardId || null);
}

module.exports = { pickInvoiceCard, shouldRestageCard };
