"use strict";
// somar-lembrete.js — SOMAR-HORARIO-1A1: grava mais um horário de lembrete numa tarefa que já
// existe, sem tocar no que já estava. I/O mínimo (supabase injetado — testável com banco em memória).
//
// Pendentes = tasks.remind_at ainda não disparado + linhas de task_reminders com sent_at nulo.
//   - nenhum pendente → o horário novo vira o remind_at da tarefa (re-armado: reminded_at = null);
//   - já existe o mesmo instante → nada a gravar ("jaTinha");
//   - horário que JÁ PASSOU → NÃO grava ("passado"): o dispatcher o consumiria calado como "nasceu
//     vencido" (REMINDER-STALE-PAST) e ele ainda ocuparia vaga do teto (Yuri 09/10: "dia 9 às 10h"
//     pedido às 12h22 tomou a vaga do 28/10);
//   - estoura o teto (lib/teto-lembretes: 3 por tarefa, 30 min entre eles) → NÃO grava ("teto");
//   - senão → linha nova em task_reminders ("somou").
// Devolve SEMPRE `horarios` = o que ficou gravado de verdade (a confirmação fala disso, e só disso).
const { limitarLembretes } = require("../lib/teto-lembretes");

function _iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function somarLembreteNaTarefa({ supabase, taskId, iso, now = new Date() }) {
  const novo = _iso(iso);
  if (!novo) return { status: "invalido", horarios: [] };
  const { data: t, error: eT } = await supabase
    .from("tasks").select("id, title, remind_at, reminded_at, status").eq("id", taskId).maybeSingle();
  if (eT || !t) return { status: "erro", erro: (eT && eT.message) || "tarefa_nao_achada", horarios: [] };
  const { data: linhas, error: eL } = await supabase
    .from("task_reminders").select("id, remind_at, sent_at").eq("task_id", taskId).is("sent_at", null);
  if (eL) return { status: "erro", erro: eL.message, titulo: t.title, horarios: [] };

  const pend = new Set();
  const atual = _iso(t.remind_at);
  const disparou = atual && t.reminded_at && new Date(t.reminded_at).getTime() >= new Date(atual).getTime();
  if (atual && !disparou) pend.add(atual);
  for (const l of linhas || []) { const x = _iso(l.remind_at); if (x) pend.add(x); }
  const existentes = [...pend].sort();

  // Mesma tolerância de 60s do guard REMINDER-STALE-PAST do dispatcher.
  if (new Date(novo).getTime() < new Date(now).getTime() - 60_000) {
    return { status: "passado", titulo: t.title, horarios: existentes };
  }

  if (!existentes.length) {
    const { rearmaAoRemarcar } = require("../lib/rearma-lembrete");
    const { error } = await supabase.from("tasks").update({ remind_at: novo, ...rearmaAoRemarcar(novo, now) }).eq("id", taskId);
    if (error) return { status: "erro", erro: error.message, titulo: t.title, horarios: [] };
    return { status: "definiu", titulo: t.title, horarios: [novo] };
  }
  if (existentes.includes(novo)) return { status: "jaTinha", titulo: t.title, horarios: existentes };
  const teto = limitarLembretes([...existentes, novo]);
  if (!teto.mantidos.includes(novo) || existentes.some((h) => !teto.mantidos.includes(h))) {
    return { status: "teto", titulo: t.title, horarios: existentes };
  }
  const { error: eI } = await supabase.from("task_reminders").insert({ task_id: taskId, remind_at: novo, label: null });
  if (eI) return { status: "erro", erro: eI.message, titulo: t.title, horarios: existentes };
  return { status: "somou", titulo: t.title, horarios: [...existentes, novo].sort() };
}

module.exports = { somarLembreteNaTarefa };
