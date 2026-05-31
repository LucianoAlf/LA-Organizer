// src/finance/txn-target.js
// Lógica pura: resolve QUAL transação recente o usuário quer editar/excluir. Sem I/O.
// candidates: [{id, amount, category, description, transaction_date}], recente→antigo.

function resolveTxnTarget(rawText, candidates) {
  const cands = Array.isArray(candidates) ? candidates : [];
  if (!cands.length) return { kind: 'none' };
  const t = String(rawText || '').toLowerCase().trim();

  // 1) valor explícito ("a de 30", "era 80", "R$ 30")
  const numMatch = t.match(/\b(?:r\$\s*)?(\d{1,7})(?:[.,]\d{1,2})?\b/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    const byVal = cands.filter((c) => Math.round(Number(c.amount)) === val);
    if (byVal.length === 1) return { kind: 'one', txn: byVal[0] };
    if (byVal.length > 1) return { kind: 'many', candidates: byVal };
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

  // 3) pronome OU nenhuma referência → assume o mais recente
  return { kind: 'one', txn: cands[0] };
}

module.exports = { resolveTxnTarget };
