'use strict';

// weekly-plan-normalize.js — tolera os formatos que o LLM realmente emite no
// <<WEEKLY_PLAN>> e normaliza pro schema canônico (goals + distribution). PURO.
//
// O PROBLEMA (Quintela 03/08, medido em marker_logs)
// O planejamento semanal é um fluxo MULTI-TURNO. A skill `planejamento-semanal.md`
// documenta o schema certo e foi carregada às 19:24:29 — mas no turno em que o marker foi
// EFETIVAMENTE emitido (19:25:21) o seletor já tinha trocado pra `criar-recorrencia`. O LLM
// emitiu o marker de memória, inventando o formato, e o parser rejeitou:
//   19:25 → {"week_start":"…","days":{"monday":"…","tuesday":"…"}}
//   21:13 → {"week_start":"…","items":[{"day":"…","title":"…","status":"done"}]}
// Duas tentativas, dois formatos, nenhum com `goals`/`distribution`. E `schema_invalid` NÃO
// tem retry (o auto-retry do engine só cobre "verbalizou promessa e não emitiu marker"), então
// o plano morreu em silêncio enquanto o TOM dizia "✅ Plano registrado".
//
// POR QUE NORMALIZAR EM VEZ DE SÓ CORRIGIR O PROMPT
// Precedente direto: o MEMORY_SAVE passou por isto em 05/08 (caso Matheus) e a solução foi
// aceitar sinônimos no parser — `extrairConteudoMemoria`. A skill já documenta o formato
// certo; o que falha é o marker sair num turno em que a skill não está à vista, e prompt
// nenhum conserta isso. Normalizar é defesa de modelo: o dado que o LLM mandou é suficiente
// pra montar o plano, então montar.
//
// NÃO INVENTA DADO: só reorganiza o que veio. Se não der pra derivar dia e item, devolve null
// e o parser rejeita como antes.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GOALS = 5;

// Nomes de dia → offset a partir de week_start (segunda). Aceita PT e EN porque o LLM
// alterna entre os dois, e sem acento porque nem sempre vem acentuado.
const DIA_OFFSET = {
  segunda: 0, 'segunda-feira': 0, seg: 0, monday: 0, mon: 0,
  terca: 1, 'terça': 1, 'terca-feira': 1, 'terça-feira': 1, ter: 1, tuesday: 1, tue: 1,
  quarta: 2, 'quarta-feira': 2, qua: 2, wednesday: 2, wed: 2,
  quinta: 3, 'quinta-feira': 3, qui: 3, thursday: 3, thu: 3,
  sexta: 4, 'sexta-feira': 4, sex: 4, friday: 4, fri: 4,
  sabado: 5, 'sábado': 5, sab: 5, saturday: 5, sat: 5,
  domingo: 6, dom: 6, sunday: 6, sun: 6,
};

function _addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const _norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// distribution já agrupado por dia, na ordem em que os dias apareceram.
function _agrupar(pares) {
  const porDia = new Map();
  for (const { day, item } of pares) {
    if (!ISO_DATE_RE.test(day) || !item) continue;
    if (!porDia.has(day)) porDia.set(day, []);
    const lista = porDia.get(day);
    if (!lista.includes(item)) lista.push(item);   // o LLM repete título às vezes
  }
  return [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, items]) => ({ day, items }));
}

/**
 * Normaliza um payload de WEEKLY_PLAN pro schema canônico.
 * @param {object} plan  o JSON que veio no marker
 * @returns {object|null} {week_start, goals, distribution} ou null se não der pra derivar
 */
function normalizeWeeklyPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const weekStart = typeof plan.week_start === 'string' && ISO_DATE_RE.test(plan.week_start)
    ? plan.week_start : null;
  if (!weekStart) return null;

  // Já canônico: não mexe.
  if (Array.isArray(plan.goals) && Array.isArray(plan.distribution)) return plan;

  const pares = [];

  // Forma A — items: [{day, title}] (a de 21:13). `day` pode vir ISO ou nome de dia.
  if (Array.isArray(plan.items)) {
    for (const it of plan.items) {
      if (!it || typeof it !== 'object') continue;
      const titulo = String(it.title || it.item || it.name || '').trim();
      let dia = String(it.day || it.date || '').trim();
      if (!ISO_DATE_RE.test(dia)) {
        const off = DIA_OFFSET[_norm(dia)];
        dia = off == null ? '' : _addDays(weekStart, off);
      }
      if (dia && titulo) pares.push({ day: dia, item: titulo });
    }
  }

  // Forma B — days: {monday: "...", ...} (a de 19:25). Valor pode ser string ou array.
  if (plan.days && typeof plan.days === 'object' && !Array.isArray(plan.days)) {
    for (const [nome, valor] of Object.entries(plan.days)) {
      const off = DIA_OFFSET[_norm(nome)];
      const dia = off == null ? (ISO_DATE_RE.test(nome) ? nome : null) : _addDays(weekStart, off);
      if (!dia) continue;
      for (const v of (Array.isArray(valor) ? valor : [valor])) {
        const titulo = String(v || '').trim();
        if (titulo) pares.push({ day: dia, item: titulo });
      }
    }
  }

  const distribution = _agrupar(pares);
  if (!distribution.length) return null;

  // goals = os itens distintos, na ordem. O parser limita a 5; truncar aqui é melhor que
  // perder o plano inteiro — a `distribution` continua com TODOS os itens.
  const vistos = [];
  for (const d of distribution) for (const i of d.items) if (!vistos.includes(i)) vistos.push(i);
  const goals = (Array.isArray(plan.goals) && plan.goals.length ? plan.goals : vistos).slice(0, MAX_GOALS);
  if (!goals.length) return null;

  return { ...plan, week_start: weekStart, goals, distribution };
}

module.exports = { normalizeWeeklyPlan, MAX_GOALS };
