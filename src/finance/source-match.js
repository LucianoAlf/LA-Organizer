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

  // 3) nome — DUAS PASSADAS, não uma checagem por candidato.
  //
  // MATCHSOURCE-PREFIXO-GENERICO-CHUTA-ERRADO (14/08): candidatos de cartão em produção têm
  // prefixo genérico compartilhado ("Cartão Nubank", "Cartão Itaú" — confirmado em
  // pf_cards.name real). A versão antiga testava full-name E 1ª-palavra no MESMO predicado,
  // candidato por candidato: ao chegar em "Cartão Itaú" primeiro na lista, a checagem de
  // 1ª-palavra ("cartão") já batia como token solto dentro de "cartão nubank" (o texto do
  // usuário) — e `.find()` retornava Itaú ANTES de sequer testar o full-name de Nubank, que
  // seria PERFEITO. Resposta EXATA resolvia pro cartão ERRADO, em silêncio — pior que repetir
  // a pergunta, porque não avisa.
  //
  // Passada 1 (specific): full-name em TODOS os candidatos primeiro — a resposta exata sempre
  // vence antes de qualquer heurística de marca entrar em jogo.
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const porNomeCompleto = cands.find((c) => {
    const name = String(c.name || '').toLowerCase().trim();
    return name && t.includes(name);
  });
  if (porNomeCompleto) return porNomeCompleto;

  // Passada 2 (fallback): marca — pula prefixo GENÉRICO ("cartão"/"conta"/"carteira"/"banco")
  // pra achar a palavra que de fato distingue ("nubank", "itaú", "c6"). Sem isso, resposta só
  // com a palavra genérica ("cartão", sem marca) chutaria o 1º candidato da lista — mesmo
  // problema, forma mais rasa. Fica null nesse caso: ambíguo de verdade não casa (mesma
  // filosofia do número fora do range).
  const GENERICO = new Set(['cartão', 'cartao', 'conta', 'carteira', 'banco']);
  const byName = cands.find((c) => {
    const name = String(c.name || '').toLowerCase().trim();
    if (!name) return false;
    const palavras = name.split(/\s+/).filter((w) => !GENERICO.has(w));
    const marca = palavras[0];
    return !!marca && marca.length >= 2 && new RegExp(`\\b${escapeRe(marca)}\\b`).test(t);
  });
  return byName || null;
}

module.exports = { matchSourceReply };
