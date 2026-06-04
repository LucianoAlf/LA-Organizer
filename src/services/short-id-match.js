// src/services/short-id-match.js
// Sprint 31.14 (cadeira ADM 03/06) — matching de short-id TOLERANTE a UUID alucinado.
//
// O LLM frequentemente só conhece o SHORT-ID de 8 hex de um item (ex.: o engine loga
// "tarefa criada ... id=1aede3b5" e é isso que volta no histórico). Mas, instruído a usar
// o UUID COMPLETO (bloco [COBRANÇAS ABERTAS], fix UUID-ID), ele preenche os 28 chars que
// faltam com LIXO — gera um uuid de formato válido mas com tail inventado:
//   real:       1aede3b5-7ac1-4889-9bc3-030a834d3b4d
//   alucinado:  1aede3b5-f1f8-4b5e-9b1a-2c3d4e5f6a7b   (head 1aede3b5 OK, resto inventado)
// O matcher antigo fazia id.startsWith(uuidCompleto) → não casava → reschedule rejeitado →
// guardrail anti-mentira anexava "não consegui registrar". Caso cadeira da ADM (Clayton→Alf).
//
// O head de 8 hex é a parte ESTÁVEL. Aqui: tenta match exato por prefixo; se falhar e o id
// veio "comprido" (>=12 hex, sinal de uuid completo), tenta de novo só pelos 8 primeiros.
// A desambiguação (matches>1) continua com quem chama (escopo já é por colaborador).

'use strict';

/** Normaliza pra comparação hex-a-hex (lowercase, sem hífens). */
function normHex(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/-/g, '');
}

/**
 * @param {Array<{id:string}>} rows — linhas já escopadas ao colaborador
 * @param {string} shortId — id vindo do marker (short de 4-12 hex OU uuid completo)
 * @returns {Array} subconjunto de rows que casam (0, 1 ou N — caller trata ambiguidade)
 */
function matchRowsByShortId(rows, shortId) {
  const list = Array.isArray(rows) ? rows : [];
  const pfx = normHex(shortId);
  if (!pfx) return [];
  let m = list.filter(r => normHex(r && r.id).startsWith(pfx));
  // Fallback tail-alucinado: id comprido (>=12 hex) sem match exato → recua pro head de 8.
  if (m.length === 0 && pfx.length >= 12) {
    const head = pfx.slice(0, 8);
    m = list.filter(r => normHex(r && r.id).startsWith(head));
  }
  return m;
}

module.exports = { matchRowsByShortId, normHex };
