'use strict';
// src/services/group-recurrence-invariants.js — PURO. Invariantes da recorrência de pacote de
// grupo, usadas pelo replay integral (scripts/replay-lab-cenario-grupo-recorrencia.js) e por
// testes. Verdade única (spec 2026-08-17): uma linha "viva" = is_recurrence_template !== true.
// O blueprint (molde + filhas-template) NUNCA conta como trabalho vivo.

function _norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .replace(/\s+/g, ' ')
    .trim();
}

// Conta linhas VIVAS (não-template) pendentes de um título, com due_date no intervalo [ymdIni,ymdFim].
// rows: [{ title, due_date, status, is_recurrence_template }]. É a asserção-mãe do Cenário 1
// (criar mensal ⇒ exatamente 1 filha viva por título/ciclo; hoje dá 2 por causa da dupla verdade).
function contarVivasPorCicloTitulo(rows, { titulo, ymdIni, ymdFim } = {}) {
  const t = _norm(titulo);
  return (Array.isArray(rows) ? rows : []).filter((r) =>
    r && r.is_recurrence_template !== true
    && r.status === 'pending'
    && _norm(r.title) === t
    && (!ymdIni || String(r.due_date || '') >= ymdIni)
    && (!ymdFim || String(r.due_date || '') <= ymdFim)
  ).length;
}

// Invariante TRANSVERSAL do replay: um resolvedor de ação por título NUNCA deve receber blueprint.
// rows = o conjunto que o resolvedor recebeu. true se há qualquer template ali (= bug).
function temBlueprintNoConjunto(rows) {
  return (Array.isArray(rows) ? rows : []).some((r) => r && r.is_recurrence_template === true);
}

module.exports = { contarVivasPorCicloTitulo, temBlueprintNoConjunto };
