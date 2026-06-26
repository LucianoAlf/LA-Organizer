'use strict';
// RAIZ 1 — Fatia 4: backstop anti-molde-recorrente-duplicado na CRIAÇÃO (1:1 / PWA).
//
// O dedup de molde vivia SÓ no grupo (findDuplicatePackage). O 1:1 (delegação) podia criar
// 2 moldes idênticos numa rajada (Gabi/Jereh "quadruplicou"). Este helper PURO espelha a
// similaridade por tokens do grupo, para o caller (engine 1:1 + PWA QuickCreate) reusar o
// molde ativo existente em vez de criar um 2º.
//
// Critério de duplicata (alinhado à spec): MESMA recurrence_rule + título SIMILAR, entre os
// moldes ATIVOS (recurrence_rule != null, recurrence_parent_id == null, series_ended_at null,
// status != cancelled). Só candidato recorrente deduplica (não toca tarefa avulsa).
// Self-contained de propósito (sem acoplar no group-chat-tasks.js).

// Tokens normalizados: minúsculo, sem acento, só alfanumérico, descarta tokens curtos
// (≤2 chars = "de/do/da/e/o/a") que poluem a similaridade.
function normTokens(title) {
  return new Set(
    String(title || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

// Jaccard entre dois conjuntos de tokens (0..1).
function similarity(a, b) {
  if (!a || !b || !a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * @param {Array<object>} existing moldes existentes do MESMO dono (o caller filtra por assigned_to)
 * @param {{title?:string, recurrence_rule?:string|null}} candidate o que vai ser criado
 * @param {number} [threshold=0.8] similaridade mínima de título
 * @returns {object|null} o molde duplicado (reusar) ou null (pode criar)
 */
function findDuplicateRecurrenceTemplate(existing, candidate, threshold = 0.8) {
  if (!candidate || candidate.recurrence_rule == null) return null; // só molde recorrente deduplica
  const candTok = normTokens(candidate.title);
  if (!candTok.size) return null;
  const list = Array.isArray(existing) ? existing : [];
  let best = null;
  let bestSim = 0;
  for (const t of list) {
    if (!t) continue;
    if (t.recurrence_rule == null || t.recurrence_parent_id != null) continue; // não é molde
    if (t.series_ended_at) continue;            // série encerrada → não é dup
    if (t.status === 'cancelled') continue;     // molde cancelado → não é dup
    if (t.recurrence_rule !== candidate.recurrence_rule) continue; // rule diferente = série distinta
    const sim = similarity(candTok, normTokens(t.title));
    if (sim > bestSim) { bestSim = sim; best = t; }
  }
  return bestSim >= threshold ? best : null;
}

module.exports = { findDuplicateRecurrenceTemplate, normTokens, similarity };
