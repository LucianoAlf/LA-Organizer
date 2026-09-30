// src/rituals/leader-verdict.js
// VEREDITO ÚNICO DO LÍDER — fonte de verdade da COR de cada líder no dia, lida pelos DOIS
// rituais de governança: a visão do CEO (sendGovernanceDigest, 09:00) e o card do próprio
// líder (sendLeaderGovernanceDigest, 14:00). PURO e SÍNCRONO: sem banco, sem LLM.
//
// CARDS-CONTRADITORIOS (30/09): 09:00 o Alf leu "0 líderes precisam de você" com Krissya,
// Jereh, Juliana e Quintela "no ritmo"; 14:00 os quatro receberam o PRÓPRIO card 🔴. Mesmo
// dia, mesmos dados — a cor saía de DUAS contas diferentes em ceoTeamUnclosedTasksReport:
//   1. degrau: o caminho do CEO cortava as tarefas em >= 6 dias ÚTEIS ANTES de classificar;
//      o do líder, em >= 3. Duda (6d corridos = 5 úteis), Ramon (5d = 4 úteis) e Jhonatan
//      (6/5/4d = 5/4/3 úteis) sumiam da conta do CEO → 0 pendência → 🟢 "no ritmo".
//   2. escopo: o CEO roteava cada tarefa a UM líder (o principal); o líder conta TODA tarefa
//      em que é viewer (fan-out). Ramon → Juliana E Quintela: na visão do CEO a Quintela
//      nunca teria pendência, mesmo com o degrau certo.
//   3. scorecard: com show_scorecard=false o CEO classificava SEM a taxa (closureRate null) —
//      a mesma pessoa podia sair 🟡 lá e 🔴 no card dela.
//   4. (irmão) o caminho do líder usava a lista SEM o guard de gêmea concluída (dispatcher).
//
// Conserto: a cor (e o nº de pendências do cabeçalho) de TODO líder vem de
// `vereditoDosLideres` — escopo do líder (viewer), degrau do líder (>= 3 dias úteis),
// scorecard real. O CEO continua vendo o DETALHE só do que passou de 6 dias úteis (escada da
// Fase 8 — ele não recebe item de 3 dias), mas o CABEÇALHO, o "N líderes precisam de você"
// e o "No ritmo" saem do veredito. Mesmo dia + mesmos dados ⇒ mesma cor, por construção.
'use strict';

const { buildLeaderCards, classifyCard } = require('./leader-cards');
const { resolveLeadersOf, governanceViewerIdsOf } = require('../services/leader-routing');
const { businessDaysOverdue } = require('../utils/dates');

const LIMIAR_LIDER_DIAS_UTEIS = 3;
const LIMIAR_CEO_DIAS_UTEIS = 6;

const nomeCurto = (c) => String((c && (c.preferred_name || c.full_name)) || '').split(' ')[0] || '—';

// Quem é líder: lidera >= 1 pessoa ativa por qualquer regra, e não é o CEO. MESMA regra do
// `leaderIds` de buildLeaderCards (modo CEO) — é o universo do "No ritmo".
function lideresDoTime(collabs) {
  const list = Array.isArray(collabs) ? collabs : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const ids = new Set();
  for (const c of list) for (const l of resolveLeadersOf(c, list)) if (l.id !== c.id) ids.add(l.id);
  return [...ids].filter((id) => byId.get(id) && !byId.get(id).is_ceo);
}

// Tarefas que contam pro líder: as PRÓPRIAS dele (o CEO sempre as viu no card dele, bloco
// "Próprias") + as em que ele é viewer (delegador, ou líder do dono pela regra única) — e o
// atraso já é problema DELE (>= 3 dias úteis). Antes o card do líder só via o time (viewer
// de tarefa de líder é o CEO), então a mesma tarefa própria contava na cor do CEO e não na dele.
function tarefasDoLider(tasks, leaderId, collabs, today) {
  const list = Array.isArray(collabs) ? collabs : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  return (tasks || []).filter((t) => t && t.due_date
    && businessDaysOverdue(t.due_date, today) >= LIMIAR_LIDER_DIAS_UTEIS
    && (t.assigned_to === leaderId
      || governanceViewerIdsOf(t, byId.get(t.assigned_to), list).includes(leaderId)));
}

// scorecards: Map leaderId -> { closure_rate }. SEMPRE o real — mostrar ou não o % é
// decisão de EXIBIÇÃO (show_scorecard), nunca da cor.
function vereditoDosLideres({ tasks, collabs, scorecards, today }) {
  const list = Array.isArray(collabs) ? collabs : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const out = new Map();
  for (const leaderId of lideresDoTime(list)) {
    const tarefas = tarefasDoLider(tasks, leaderId, list, today);
    const own = tarefas.filter((t) => t.assigned_to === leaderId).length;
    const stuck = tarefas.filter((t) => (t.coordination_request_count || 0) >= 3).length;
    const sc = (scorecards && scorecards.get(leaderId)) || {};
    const closureRate = (sc.closure_rate === null || sc.closure_rate === undefined) ? null : sc.closure_rate;
    const dot = classifyCard({ closureRate, overdueLive: tarefas.length, stuckLive: stuck });
    out.set(leaderId, { leaderId, name: nomeCurto(byId.get(leaderId)), dot, closureRate,
      closurePct: closureRate === null ? null : Math.round(100 * closureRate),
      pendencias: tarefas.length, totals: { all: tarefas.length, team: tarefas.length - own, own },
      stuck, tarefas });
  }
  return out;
}

const contaTarefasNoCorpo = (card) => (card.people || [])
  .reduce((s, b) => s + (b.novo || []).length + (b.arrastando || []).length, 0);

// Card do PRÓPRIO líder (digest das 14:00). Tarefas = as do veredito; cor = a do veredito.
function montarCardDoLider({ tasks, collabs, scorecards, today, leaderId, veredito }) {
  const vs = veredito || vereditoDosLideres({ tasks, collabs, scorecards, today });
  const v = vs.get(leaderId);
  const built = buildLeaderCards({ tasks: v ? v.tarefas : [], events: [], collabs, scorecards, today, forLeaderId: leaderId });
  for (const card of built.cards) {
    if (!v) continue;
    card.dot = v.dot;
    card.closurePct = v.closurePct;
    card.totals = { ...v.totals };
  }
  return built;
}

// Visão do CEO (digest das 09:00). Corpo = escada da Fase 8 (só o que passou de 6 dias úteis,
// roteado pro líder principal, + compromissos); cor/cabeçalho/ritmo = veredito.
// mostrarPct=false (show_scorecard) esconde o % SEM mudar a cor.
function montarVisaoDoCeo({ tasks, events, collabs, scorecards, today, mostrarPct = true }) {
  const veredito = vereditoDosLideres({ tasks, collabs, scorecards, today });
  const escaladas = (tasks || []).filter((t) => t && t.due_date
    && businessDaysOverdue(t.due_date, today) >= LIMIAR_CEO_DIAS_UTEIS);
  const built = buildLeaderCards({ tasks: escaladas, events: events || [], collabs, scorecards, today });

  const cards = [];
  const comCard = new Set();
  for (const card of built.cards) {
    const v = veredito.get(card.leader.id);
    if (v) {
      card.dot = v.dot;
      card.closurePct = v.closurePct;
      // Só compromisso (0 tarefa no veredito): o líder não tem card pra comparar — o
      // cabeçalho segue contando o corpo (os compromissos), senão diria "0 pendências".
      if (v.pendencias > 0) card.totals = { ...v.totals };
      const fora = v.pendencias - contaTarefasNoCorpo(card);
      if (fora > 0) card.nota = `_+${fora} só no card do próprio líder (menos de ${LIMIAR_CEO_DIAS_UTEIS} dias úteis ou de outro líder)_`;
    }
    cards.push(card);
    comCard.add(card.leader.id);
  }
  // Líder vermelho/amarelo pelo veredito sem nada escalado pro CEO: antes caía no "No ritmo".
  for (const v of veredito.values()) {
    if (v.dot === '🟢' || comCard.has(v.leaderId)) continue;
    cards.push({ leader: { id: v.leaderId, name: v.name }, coLeaders: [], dot: v.dot, closurePct: v.closurePct,
      totals: { ...v.totals }, people: [],
      nota: `_nada passou de ${LIMIAR_CEO_DIAS_UTEIS} dias úteis — detalhe no card do próprio líder_` });
    comCard.add(v.leaderId);
  }
  if (!mostrarPct) for (const c of cards) c.closurePct = null;

  const peso = (d) => (d === '🔴' ? 0 : d === '🟡' ? 1 : 2);
  cards.sort((a, b) => peso(a.dot) - peso(b.dot) || b.totals.all - a.totals.all
    || a.leader.name.localeCompare(b.leader.name, 'pt-BR') || a.leader.id.localeCompare(b.leader.id));

  const ritmo = [...veredito.values()]
    .filter((v) => v.dot === '🟢' && !comCard.has(v.leaderId))
    .map((v) => ({ id: v.leaderId, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
  const precisam = [...veredito.values()].filter((v) => v.dot !== '🟢').length;

  return { cards, unassigned: built.unassigned, ritmo, precisam, veredito };
}

module.exports = { vereditoDosLideres, lideresDoTime, tarefasDoLider, montarCardDoLider, montarVisaoDoCeo,
  LIMIAR_LIDER_DIAS_UTEIS, LIMIAR_CEO_DIAS_UTEIS };
