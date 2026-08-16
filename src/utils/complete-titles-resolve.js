'use strict';
// complete-titles-resolve.js — Fatia 4 (confirmação parse-on-open, complete/fechamento).
//
// Resolve a lista de TÍTULOS (extraída da pergunta do TOM) em short-ids pra payload.batch_complete.
// FAIL-CLOSED: só devolve ids se TODOS os títulos resolverem 'exato' via resolveTaskTarget (que já
// fail-closa em série/linhagem ambígua). Um ambíguo/não-achado → null (o hook mantém payload só-
// texto de hoje). Fechar a tarefa errada é o risco (dor #1 do TASK_UPDATE) — na dúvida, não estagia.
//
// queryCandidatos e resolveTaskTarget são INJETADOS (helper testável sem DB). No engine:
//   queryCandidatos = título => tasks(assigned_to=collab, ilike '%título%', not done/cancelled).
//   resolveTaskTarget = require('../lib/task-target').resolveTaskTarget.

function _short(id) {
  return String(id).replace(/-/g, '').slice(0, 8);
}

async function resolveTitlesToBatchComplete({ queryCandidatos, resolveTaskTarget, titles } = {}) {
  if (!Array.isArray(titles) || !titles.length) return null;
  if (typeof queryCandidatos !== 'function' || typeof resolveTaskTarget !== 'function') return null;

  const ids = [];
  for (const title of titles) {
    let cands = [];
    try {
      cands = await queryCandidatos(title);
    } catch (_) {
      return null; // falha de leitura → fail-closed
    }
    const r = resolveTaskTarget({ candidatos: cands || [] });
    if (!r || r.modo !== 'exato' || !r.tarefa || !r.tarefa.id) return null; // fail-closed
    ids.push(_short(r.tarefa.id));
  }
  return ids.length ? { ids } : null;
}

module.exports = { resolveTitlesToBatchComplete };
