// src/finance/txn-target.js
// Lógica pura: resolve QUAL transação recente o usuário quer editar/excluir. Sem I/O.
// candidates: [{id, amount, category, description, transaction_date}], recente→antigo.

// Palavras de CAMPO/genéricas que aparecem após uma palavra-ref mas NÃO são o alvo (o token é o
// nome do campo a editar ou um genérico), então não contam como "nome-referência que falhou".
// Ex.: "muda a *categoria* pra lazer" (edit), "apaga a *última*". Sem isso o fail-closed comeria
// esses fluxos legítimos.
const FIELD_STOP = new Set([
  'categoria', 'valor', 'descrição', 'descricao', 'data', 'conta', 'cartão', 'cartao', 'saldo',
  'parcela', 'parcelas', 'fatura', 'lançamento', 'lancamento', 'transação', 'transacao',
  'última', 'ultima', 'último', 'ultimo', 'recente', 'compra', 'gasto', 'despesa', 'receita', 'coisa',
]);
// Token de conteúdo após uma palavra-ref ISOLADA (boundary (?:^|\s) — por isso "pra lazer" não
// conta: o "a" está dentro de "pra"). Usado só pra detectar nome-referência que NÃO bateu.
const REF_TOKEN_RE = /(?:^|\s)(?:d[ao]s?|n[ao]s?|de|um[a]?|essa|esse|aquela?|aquele|[oa])\s+(\p{L}{3,})/giu;

// O texto nomeou um alvo (via palavra-ref isolada + token de conteúdo não-genérico) que NÃO casa
// nenhum candidato? Só chamado quando byName já deu vazio → qualquer token de conteúdo aqui é um
// nome que falhou (byName teria pego se casasse).
function _nomeRefFalhou(t, cands) {
  REF_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = REF_TOKEN_RE.exec(t)) !== null) {
    const tok = m[1].toLowerCase();
    if (FIELD_STOP.has(tok)) continue;
    const casaCandidato = cands.some((c) => {
      const d = c.description ? String(c.description).toLowerCase() : '';
      const ct = c.category ? String(c.category).toLowerCase() : '';
      return (d && (d.includes(tok) || tok.includes(d))) || (ct && (ct.includes(tok) || tok.includes(ct)));
    });
    if (!casaCandidato) return true;
  }
  return false;
}

function resolveTxnTarget(rawText, candidates) {
  const cands = Array.isArray(candidates) ? candidates : [];
  if (!cands.length) return { kind: 'none' };
  const t = String(rawText || '').toLowerCase().trim();

  // 1) valor explícito ("a de 30", "era 80", "R$ 30")
  let valorEspecificado = false;
  const numMatch = t.match(/\b(?:r\$\s*)?(\d{1,7})(?:[.,]\d{1,2})?\b/);
  if (numMatch) {
    valorEspecificado = true;
    const val = parseInt(numMatch[1], 10);
    const byVal = cands.filter((c) => Math.round(Number(c.amount)) === val);
    if (byVal.length === 1) return { kind: 'one', txn: byVal[0] };
    if (byVal.length > 1) return { kind: 'many', candidates: byVal };
    // valor não casou → NÃO retorna ainda: um nome no texto ainda pode resolver (ex.: "a do
    // mercado de 999"). Marca a especificidade pra fail-closar no fim se o nome também falhar.
  }

  // 2) nome (descrição ou categoria) — só conta se precedido por artigo/preposição de referência
  // "a do mercado" ✓ / "muda a categoria pra lazer" ✗ (lazer aparece após "pra", não após ref)
  const REF_BEFORE = /(?:^|\s)(?:d[ao]s?\s+|n[ao]s?\s+|de\s+|um[a]?\s+|essa\s+|esse\s+|aquela?\s+|aquele\s+|[oa]\s+d[ao]s?\s+|[oa]\s+)/;
  const byName = cands.filter((c) => {
    const desc = c.description ? String(c.description).toLowerCase() : '';
    const cat  = c.category    ? String(c.category).toLowerCase()    : '';
    const matchDesc = desc && new RegExp(REF_BEFORE.source + desc).test(t);
    const matchCat  = cat  && new RegExp(REF_BEFORE.source + cat).test(t);
    return matchDesc || matchCat;
  });
  if (byName.length === 1) return { kind: 'one', txn: byName[0] };
  if (byName.length > 1) return { kind: 'many', candidates: byName };

  // 3) FAIL-CLOSED (Fatia #2): se o usuário DEU especificidade (valor OU nome-referência) que não
  // bateu nenhum candidato, NÃO chuta o mais recente numa operação destrutiva — devolve none
  // (o handler pergunta). Caso Rose "apaga a fatura Itaú de R$950,21" → apagava o mais recente.
  if (valorEspecificado || _nomeRefFalhou(t, cands)) return { kind: 'none' };

  // 4) pronome OU nenhuma referência ("apaga isso", "desfaz o último") → assume o mais recente.
  return { kind: 'one', txn: cands[0] };
}

module.exports = { resolveTxnTarget };
