'use strict';
// habit-field-alias.js — normaliza aliases de identificação de hábito nos markers
// HABIT_ACTION. Extraído do engine (Sprint 31.6/B3 + HABIT-LOG-TITLE-ALIAS 22/06)
// para módulo puro testável.
//
// HABIT-ACTION-SO-ACEITA-ID-REJEITA-TITULO (Bianca 20/08): terceira ocorrência da
// MESMA família — `habit_slug`/`title` (22/06), `habit` (08/07), agora `habit_title`
// ({"action":"log","habit_title":"Tomar remédios"} → bad_habit_id → bloco dropado,
// hábito nunca registrado, e ela só viu a reação ✅ — que não é afirmação de TEXTO,
// então o chokepoint de honestidade não pega).
//
// O defeito não era "falta o alias X": era a LISTA. O LLM prefixa com `habit_` um
// sufixo que já aceitávamos cru, e a enumeração não cobria o produto cartesiano.
// Agora os candidatos são GERADOS (sufixo × prefixo opcional), em ordem estável —
// um prefixo novo deixa de ser um bug novo.

// Sufixos que significam "o nome do hábito", em ordem de precedência.
// slug primeiro (preserva a precedência histórica habit_slug > habit > title).
const SUFIXOS = ['slug', 'title', 'titulo', 'nome', 'name'];
// Sufixos cujo valor vem em forma de slug: hífen/underline viram espaço.
const SUFIXOS_SLUG = new Set(['slug']);

// Candidatos: `habit_<sufixo>` e `<sufixo>` cru, mais o campo nu `habit`.
// `habit_name` é o campo OFICIAL (destino), nunca um alias de si mesmo.
function candidatos(destino) {
  const out = [];
  for (const suf of SUFIXOS) {
    for (const chave of [`habit_${suf}`, suf]) {
      if (chave === destino) continue;
      out.push({ chave, slug: SUFIXOS_SLUG.has(suf) });
    }
    // `habit` nu entra logo depois de slug — era a precedência antiga (slug > habit > title).
    if (suf === 'slug') out.push({ chave: 'habit', slug: false });
  }
  return out;
}

const PARA_HABIT_NAME = candidatos('habit_name');
const PARA_NAME = candidatos('name');

function primeiroValor(a, lista) {
  for (const { chave, slug } of lista) {
    const v = a[chave];
    if (typeof v !== 'string' || !v.trim()) continue;
    return slug ? v.replace(/[-_]+/g, ' ').trim() : v;
  }
  return null;
}

// Regras:
//   create: qualquer alias de nome → name (se name ausente)
//   log/query_progress/delete: qualquer alias → habit_name
//     (só quando NÃO há habit_id nem habit_name — sem clobber)
function normalizeHabitAliases(a) {
  if (!a || typeof a !== 'object') return a;
  if (a.action === 'create' && !a.name) {
    const v = primeiroValor(a, PARA_NAME);
    if (v) a.name = v;
  }
  if ((a.action === 'log' || a.action === 'query_progress' || a.action === 'delete')
      && !a.habit_id && a.habit_name === undefined) {
    const v = primeiroValor(a, PARA_HABIT_NAME);
    if (v) a.habit_name = v;
  }
  return a;
}

module.exports = { normalizeHabitAliases };
