'use strict';
// semana-pendentes.js — SEMANA-CONTA-SEM-LISTA (Quintela 19/06 — finding 1c3472e4).
//
// O fechamento trouxe "Na semana: 11/12 concluídas (92%)". Ele perguntou "o que ficou faltando pra
// ficar 12/12?" e o TOM admitiu não ter o detalhamento — e chutou "provavelmente contou duplicados".
// O número vinha do banco (fetchPeriodStats), mas SÓ o número: o ritual nunca recebia QUAIS tarefas
// faltavam. Agora a linha da semana leva os nomes do que está pendente (mesmo título agrupado — é assim
// que "duplicado" aparece de verdade: a mesma tarefa em mais de uma ocorrência). PURO.

const MAX_NOMES = 3;

/** Títulos das tarefas não concluídas nem canceladas, agrupando repetidos: [{titulo, n}]. */
function pendentesDaSemana(tasks) {
  const cont = new Map();
  for (const t of (Array.isArray(tasks) ? tasks : [])) {
    if (!t || ['done', 'cancelled'].includes(t.status)) continue;
    const titulo = String(t.title || '').trim();
    if (!titulo) continue;
    cont.set(titulo, (cont.get(titulo) || 0) + 1);
  }
  return [...cont.entries()].map(([titulo, n]) => ({ titulo, n }));
}

/** "Tarefas: 11/12 concluídas (92%) · 1 pendente — falta: *X*" */
function linhaSemana(s) {
  const base = `Tarefas: ${s.done}/${s.total} concluídas${s.pct !== null && s.pct !== undefined ? ` (${s.pct}%)` : ''} · ${s.pending} ${s.pending === 1 ? 'pendente' : 'pendentes'}`;
  const lista = Array.isArray(s.pendentes) ? s.pendentes : [];
  if (!s.pending || !lista.length) return base;
  const nomes = lista.slice(0, MAX_NOMES).map((p) => `*${p.titulo}*${p.n > 1 ? ` (${p.n}x)` : ''}`).join(', ');
  const resto = lista.length > MAX_NOMES ? ` +${lista.length - MAX_NOMES}` : '';
  return `${base} — falta: ${nomes}${resto}`;
}

module.exports = { pendentesDaSemana, linhaSemana };
