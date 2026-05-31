// src/finance/source-match.js
// Lógica pura: casa a resposta do usuário à pergunta de fonte. Sem I/O.

const CARD_RE = /\b(cart[ãa]o|cr[ée]dito|fatura|parcel)/i;
const ACCT_RE = /\b(conta|carteira|d[ée]bito|corrente)\b/i;
const CASH_RE = /\b(dinheiro|esp[ée]cie|cash|em\s+m[ãa]o)\b/i;
// Comandos de tarefa/evento — uma resposta de fonte NUNCA começa assim.
// Protege contra falso-positivo quando há pending aberta e o user pivota de assunto.
const COMMAND_RE = /^(marca|marque|cria|crie|criar|agenda|agende|agendar|liga|ligar|lembra|lembre|lembrar|compr|programa|avisa|chama)/i;

function matchSourceReply(rawText, payload) {
  const t = String(rawText || '').toLowerCase().trim();
  if (!t || t.length > 200 || !payload) return null;
  if (COMMAND_RE.test(t)) return null; // comando de tarefa/evento, não é resposta de fonte

  const wordCount = t.split(/\s+/).filter(Boolean).length;

  if (payload.form === 'binary') {
    if (wordCount > 5) return null;
    if (CARD_RE.test(t)) return payload.card;
    if (ACCT_RE.test(t)) return payload.account;
    return null;
  }

  // form === 'list'
  const cands = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!cands.length) return null;

  // 1) número 1-based — só conta se a msg for curta (resposta-de-número, não frase com número)
  const numMatch = t.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    if (wordCount > 3) return null; // "marca reunião dia 2 ..." / "to chegando em 2 min" não casam
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < cands.length) return cands[idx];
    return null; // número fora do range = resposta explícita errada, não chuta nome
  }

  if (wordCount > 5) return null;

  // 2) "dinheiro" explícito casa o candidato cash
  if (CASH_RE.test(t)) {
    const cash = cands.find((c) => c.kind === 'cash');
    if (cash) return cash;
  }

  // 3) nome — casa o candidato cujo nome COMPLETO ou cuja 1ª palavra (a marca:
  //    "c6", "nubank", "itau") aparece como token no texto. "salva no c6" casa "C6 Bank".
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const byName = cands.find((c) => {
    const name = String(c.name || '').toLowerCase().trim();
    if (!name) return false;
    if (t.includes(name)) return true;
    const first = name.split(/\s+/)[0];
    return first.length >= 2 && new RegExp(`\\b${escapeRe(first)}\\b`).test(t);
  });
  return byName || null;
}

module.exports = { matchSourceReply };
