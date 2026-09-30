"use strict";
// src/rituals/personal-recurrentes.js — planejamento PURO das completions diárias das listas
// pessoais recorrentes (Sprint 23). O I/O fica em dispatcher.dispatchPersonalRecurrentes.
//
// CHECKLISTS-PESSOAIS-PARADOS (30/09/2026): o cron pedia `personal_checklists.user_id` e filtrava
// `archived_at` — a tabela tem owner_collab_id e is_active (web/useChecklistsHoje.ts já avisava).
// O select falhava em toda rodada desde 11/06 e o erro só ia pro rituals.log.
//
// SEM BACKFILL, por desenho: só a data de HOJE (ymd). Os dias parados não viram fila de
// completions atrasadas — o "Hoje" do PWA/TOM lê pela âncora do ciclo, então a retomada é 1 linha
// por lista que vale hoje. Nada aqui manda WhatsApp.
//
// LISTA SEM ITENS é pulada (decisão 30/09): completion de lista vazia só viraria dia "0/0" no
// histórico. Conta como pulada e sai numa linha de log só com a contagem.
const { recurrenceAppliesToday } = require("../services/personalCompletions");

const PERSONAL_RECORRENTES_SELECT =
  "id, owner_collab_id, recurrence_type, days_of_week, day_of_month, name, is_active, personal_checklist_items(id)";

// Teto por rodada: hoje são ~9 listas recorrentes. Se um dia vier muito mais que isso é sinal de
// dado torto, não de trabalho legítimo — cria só o teto e o dispatcher registra no log.
const MAX_CRIACOES_POR_RODADA = 100;

// Vazia = o select trouxe os itens e veio lista vazia. Sem o campo (chamador antigo) não pula.
function semItens(l) {
  return Array.isArray(l.personal_checklist_items) && l.personal_checklist_items.length === 0;
}

function planejarRecorrentesPessoaisDetalhado(lists, ymd, { jaExistem = new Set() } = {}) {
  const out = { rows: [], puladasSemItens: 0 };
  if (typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return out;
  const vistos = new Set();
  for (const l of Array.isArray(lists) ? lists : []) {
    if (!l || !l.id || !l.owner_collab_id) continue;
    if (l.is_active === false) continue;
    if (!l.recurrence_type || l.recurrence_type === "once") continue;
    if (vistos.has(l.id) || jaExistem.has(l.id)) continue;
    if (!recurrenceAppliesToday(l, ymd)) continue;
    vistos.add(l.id);
    if (semItens(l)) { out.puladasSemItens++; continue; }
    out.rows.push({ checklist_id: l.id, user_id: l.owner_collab_id, reference_date: ymd, channel: "cron" });
    if (out.rows.length >= MAX_CRIACOES_POR_RODADA) break;
  }
  return out;
}

function planejarRecorrentesPessoais(lists, ymd, opts) {
  return planejarRecorrentesPessoaisDetalhado(lists, ymd, opts).rows;
}

// 1 linha, só contagem (sem nome/telefone de ninguém). null = nada a registrar.
function linhaPuladasSemItens(n) {
  if (!Number.isInteger(n) || n <= 0) return null;
  return `[Rituals] dispatchPersonalRecurrentes pulou ${n} ${n === 1 ? "lista" : "listas"} sem itens`;
}

module.exports = {
  PERSONAL_RECORRENTES_SELECT,
  planejarRecorrentesPessoais,
  planejarRecorrentesPessoaisDetalhado,
  linhaPuladasSemItens,
  MAX_CRIACOES_POR_RODADA,
};
