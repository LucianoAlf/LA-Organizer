// Classifica a FONTE de uma transação a partir do nome dito e das listas do usuário.
// Puro: sem I/O. kind ∈ none|cash|card|account|ambiguous.
// "cartão/crédito" NÃO entram aqui como método — o roteamento pro cartão é por
// match no NOME de um cartão, não pela palavra "cartão".
const METHODS = ['pix', 'debito', 'débito', 'transferencia', 'transferência', 'ted', 'doc', 'boleto'];
const CASH_RE = /\b(dinheiro|esp[ée]cie|cash|grana|vivo)\b/i;

// Normaliza p/ match tolerante: minúsculas + remove acentos (NFD strip). Caso Rose 11/06:
// cartão salvo "Itáu" vs digitado "Itaú" — sem isto, o substring não casa (ú≠á em bytes).
function _normSrc(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function classifySource(rawName, accountNames = [], cardNames = [], opts = {}) {
  const name = _normSrc(rawName);
  if (!name) return { kind: 'none' };
  if (CASH_RE.test(name)) return { kind: 'cash' };
  if (METHODS.includes(name)) return { kind: 'none' };
  const hit = (list) => list.find((n) => {
    const x = _normSrc(n);
    return x.includes(name) || name.includes(x);
  });
  const a = hit(accountNames);
  const c = hit(cardNames);
  const type = opts.type === 'income' ? 'income' : 'expense';
  const method = String(opts.method || '').toLowerCase();
  const wantsCard = /cr[ée]dito|cart|fatura|parcel/.test(method);
  const wantsAcct = /d[ée]bito|pix|transfer|ted|doc|boleto|conta/.test(method);

  // Receita NUNCA vai pro cartão: colapsa pra conta; se só casou cartão, vira none.
  if (type === 'income') {
    if (a) return { kind: 'account', accountName: a };
    return { kind: 'none' };
  }
  // Despesa
  if (a && c) {
    if (wantsCard) return { kind: 'card', cardName: c };
    if (wantsAcct) return { kind: 'account', accountName: a };
    return { kind: 'ambiguous', accountName: a, cardName: c };
  }
  if (c) return { kind: 'card', cardName: c };
  if (a) return { kind: 'account', accountName: a };
  return { kind: 'none' };
}

module.exports = { classifySource };
