'use strict';
// lembrete-diario.js — LEMBRETE-DIARIO-POR-TAREFA (decisão do Alf, 11/09/2026 — finding bad1c55e).
//
// "Me lembra todo dia até o prazo" sobre UMA tarefa virava PREFS_UPDATE reminder_lead=daily — uma
// preferência GLOBAL que só antecipa o "vence amanhã" do briefing — e o TOM dizia "lembrete diário
// ativado" sem existir nada por tarefa. Agora a tarefa carrega tasks.lembrete_diario e o despachante
// manda UM toque por dia, do pedido até o prazo; concluída ou cancelada, para sozinho.
// PURO: quem grava é o engine; quem lê o banco e envia é o despachante.

const FECHADAS = new Set(['done', 'cancelled']);
const SIM = new Set(['true', 'sim', 'liga', 'ligar', 'on', '1']);
const NAO = new Set(['false', 'nao', 'não', 'desliga', 'desligar', 'off', '0']);

/** true | false | null (não veio / ilegível — não mexe). */
function lerFlag(v) {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (SIM.has(s)) return true;
    if (NAO.has(s)) return false;
  }
  return null;
}

const _ms = (ymd) => Date.parse(`${ymd}T12:00:00Z`);
function diasAte(hoje, prazo) { return Math.round((_ms(prazo) - _ms(hoje)) / 86400e3); }

/** Toca hoje? Tarefa aberta, com o flag, com prazo, de hoje até o prazo (inclusive). */
function elegivelHoje(task, hoje) {
  if (!task || task.lembrete_diario !== true) return false;
  if (FECHADAS.has(task.status)) return false;
  const prazo = String(task.due_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return false;
  return diasAte(hoje, prazo) >= 0;
}

function textoLembreteDiario({ nick, titulo, prazo, hoje }) {
  const d = diasAte(hoje, prazo);
  const dm = `${prazo.slice(8, 10)}/${prazo.slice(5, 7)}`;
  const quando = d === 0 ? 'vence *hoje*' : d === 1 ? 'vence amanhã' : `prazo ${dm} (faltam ${d} dias)`;
  return `🔁 ${nick}, lembrete do dia: *${titulo}* — ${quando}. Se já resolveu, me avisa que eu paro.`;
}

/** Ligar o diário exige prazo ("até quando?") e dono individual (o toque vai pra uma pessoa). */
function recusaLembreteDiario(edicao, atual) {
  if (!edicao || edicao.lembreteDiario !== true) return null;
  const t = atual || {};
  const nome = String(t.title || 'essa tarefa').slice(0, 60);
  if (t.assigned_group_id) return `*${nome}* é do grupo — o lembrete diário é pra tarefa de uma pessoa. Quer que eu passe ela pra alguém?`;
  if (!t.due_date) return `*${nome}* não tem prazo — até quando te lembro todo dia?`;
  return null;
}

module.exports = { lerFlag, diasAte, elegivelHoje, textoLembreteDiario, recusaLembreteDiario };
