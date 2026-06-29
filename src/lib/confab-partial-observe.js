'use strict';

// CONFAB-PARTIAL-LEAK (Fase 0, 26/06) — detector ESTRUTURAL puro de confab de falha parcial.
// Recebe as linhas de marker_logs DO TURNO ([{marker_type, result}]) e dispara quando
// coexistem um marker REJEITADO (R) e um EXECUTADO (E) de TIPOS DIFERENTES (R≠E) — a
// assinatura de "algo persistiu (Camada 1 não dispara) mas outra coisa falhou".
//
// NÃO olha o texto da reply: o design §4 provou que o léxico de confab (_isOptimisticLine)
// erra a classe-alvo ("fico quieto" é estado, não conclusão). Quem julga o vazamento é o
// olho humano lendo a amostra; o detector só entrega o conjunto estrutural.
//
// 'malformed' NÃO existe na coluna result (CHECK: executed/rejected/skipped/redirected/
// fallback) — marker malformado é logado como result='rejected' (reason schema_invalid).
// Então gatear em 'rejected' já cobre malformed.
//
// META: markers de telemetria/guard não são ação de domínio → fora de R e de E.
const META_MARKER_TYPES = new Set([
  'CHOKEPOINT', 'ACTIONABLE_NO_MARKER', 'PROVIDER', 'LEAK_BLOCKED',
  'UNKNOWN_MARKER_STRIPPED', 'TOOL_CALL_STRIPPED', 'CONFAB_PARTIAL_OBSERVE',
  'COUNT_HONESTY',
]);

function detectPartialConfab(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const rejected = new Set();
  const executed = new Set();
  for (const r of rows) {
    if (!r || !r.marker_type) continue;
    const type = String(r.marker_type);
    if (META_MARKER_TYPES.has(type)) continue;
    if (r.result === 'rejected') rejected.add(type);
    else if (r.result === 'executed') executed.add(type);
  }
  if (!rejected.size || !executed.size) return null;
  const rej = [...rejected];
  const exec = [...executed];
  // cross-tipo: ∃ R rejeitado e E executado com R≠E. Falha parcial MESMO-tipo (3 TASK,
  // 1 falha) já é coberta pelo sanitizeOptimisticConfirm('partial') do handler do TASK.
  const crossType = rej.some((R) => exec.some((E) => E !== R));
  if (!crossType) return null;
  return { rejected: rej, executed: exec };
}

module.exports = { detectPartialConfab, META_MARKER_TYPES };
