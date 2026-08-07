// src/lib/task-target.js
// Decide QUAL tarefa uma frase se refere, quando o título casa com várias.
//
// O defeito que este módulo existe para matar (medido em 06/08/2026): os três handlers de
// tarefa do engine resolviam por `ilike(title) + order('created_at' desc) + limit(1)`. O
// `.limit(1)` esconde a pluralidade — escolhe um e segue como se tivesse certeza — e o
// critério "criada por último" é o pior possível numa série recorrente materializada, porque
// as instâncias futuras nascem depois. Série "Presença Emusys", 35 abertas: o legado escolhia
// a de 04/09 quando a corrente era a de 01/08. Resultado: "passa pra amanhã" mexia numa
// ocorrência de setembro, a pessoa não via nada mudar e concluía que o TOM ignorou.
//
// PURO de propósito: sem banco, sem LLM, sem engine. O engine busca os candidatos e entrega;
// aqui só se decide. É o que permite provar por mutação que a regra existe de verdade.
'use strict';

/**
 * Chave da série recorrente de uma tarefa. Instância aponta para o molde; o molde é a
 * própria raiz; tarefa avulsa não tem série (null).
 */
function serieDe(t) {
  if (!t) return null;
  if (t.recurrence_parent_id) return String(t.recurrence_parent_id);
  if (t.recurrence_rule) return String(t.id);
  return null;
}

/**
 * @param {{candidatos?: Array}} arg
 * @returns {{modo:'exato'|'ambiguo'|'nenhum', tarefa?:object, candidatos?:Array, motivo:string}}
 */
function resolveTaskTarget({ candidatos } = {}) {
  const lista = Array.isArray(candidatos) ? candidatos.filter(Boolean) : [];
  if (lista.length === 0) return { modo: 'nenhum', motivo: 'sem_candidato' };
  if (lista.length === 1) return { modo: 'exato', tarefa: lista[0], motivo: 'unico' };

  // Uma avulsa com o mesmo nome no meio da lista NÃO é "a série" — é ambiguidade real.
  const series = lista.map(serieDe);
  const distintas = new Set(series.filter(Boolean));
  if (series.some((s) => s === null) || distintas.size !== 1) {
    return { modo: 'ambiguo', candidatos: lista, motivo: 'linhagens_distintas' };
  }

  const comData = lista.filter((t) => t.due_date);
  if (comData.length === 0) return { modo: 'ambiguo', candidatos: lista, motivo: 'serie_sem_data' };

  // Ciclo corrente = menor due_date. Atrasada e "mais próxima no futuro" são o mesmo ramo.
  // due_date é `date` (YYYY-MM-DD): comparação de string é segura e ordena igual a data.
  // created_at é timestamp do banco — comparado por Date.parse, nunca como string
  // (`+00:00` vs `.000Z` são o mesmo instante escrito diferente).
  const ordenado = comData.slice().sort((a, b) => {
    if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
    const ca = Date.parse(a.created_at) || 0;
    const cb = Date.parse(b.created_at) || 0;
    if (ca !== cb) return ca - cb;
    return String(a.id) < String(b.id) ? -1 : 1; // estabilidade: nunca depender da ordem de entrada
  });
  return { modo: 'exato', tarefa: ordenado[0], motivo: 'serie' };
}

module.exports = { resolveTaskTarget, serieDe };
