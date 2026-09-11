'use strict';
// remocao-copia.js — COPIA-REMOVER (decisão do Alf, 11/09/2026 — a4efeaa4).
//
// John 10/07: "tava no perfil errado", e o TOM emitiu
//   <<TASK_UPDATE>>[{"action":"remove_watchers","title":"Trancamento Pedro","watchers":["John"]}]
// — a ação não existia (só add_watchers), caiu como schema_invalid e o TOM já tinha dito "Feito!".
// Decisão: criar a ação de tirar alguém da cópia. Este módulo lê o pedido nos formatos que o LLM
// emite (espelhando o add_watchers: `id` + `cc`/`to_names`; e o real: `title` + `watchers`). PURO.
const CAMPOS_DE_NOMES = ['cc', 'watchers', 'to_names', 'names'];

function lerRemocaoCopia(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { erro: 'not_object' };
  const id = typeof a.id === 'string' && a.id.trim() ? a.id.trim() : null;
  const busca = !id && typeof a.title === 'string' && a.title.trim() ? a.title.trim() : null;
  if (!id && !busca) return { erro: 'bad_id' };
  let nomes = [];
  for (const k of CAMPOS_DE_NOMES) {
    const v = a[k];
    if (Array.isArray(v)) nomes = nomes.concat(v);
    else if (typeof v === 'string' && v.trim()) nomes.push(v);
  }
  nomes = [...new Set(nomes.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!nomes.length) return { erro: 'remove_watchers:no_names' };
  return { id, busca, nomes };
}

module.exports = { lerRemocaoCopia };
