// Classifica a FONTE de uma transação a partir do nome dito e das listas do usuário.
// Puro: sem I/O. kind ∈ none|cash|card|account|ambiguous.
// "cartão/crédito" NÃO entram aqui como método — o roteamento pro cartão é por
// match no NOME de um cartão, não pela palavra "cartão".
const METHODS = ['pix', 'debito', 'débito', 'transferencia', 'transferência', 'ted', 'doc', 'boleto'];
const CASH_RE = /\b(dinheiro|esp[ée]cie|cash|grana|vivo)\b/i;

function classifySource(rawName, accountNames = [], cardNames = []) {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name) return { kind: 'none' };
  if (CASH_RE.test(name)) return { kind: 'cash' };
  if (METHODS.includes(name)) return { kind: 'none' };
  const hit = (list) => list.find((n) => {
    const x = String(n).toLowerCase();
    return x.includes(name) || name.includes(x);
  });
  const a = hit(accountNames);
  const c = hit(cardNames);
  if (a && c) return { kind: 'ambiguous', accountName: a, cardName: c };
  if (c) return { kind: 'card', cardName: c };
  if (a) return { kind: 'account', accountName: a };
  return { kind: 'none' };
}

module.exports = { classifySource };
