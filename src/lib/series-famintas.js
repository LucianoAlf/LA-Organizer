'use strict';
// series-famintas.js — SERIE-FAMINTA (10/09/2026).
//
// De 18/08 a 10/09 o gerador de recorrência falhou TODA noite para evento ("coluna
// is_recurrence_template não existe em events") e ninguém soube: o erro ia pro rituals.log, o
// health check não olhava o gerador, e a agenda ia secando devagar — a Reunião ADM da Ana,
// as presenças diárias dela, o "Olhar o site da Estácio" da Anne Susan, que nunca apareceu.
// Em 02/07 a MESMA família (coluna que só existe em `tasks`) já tinha parado os eventos.
//
// Este sensor mede o EFEITO, não a causa: para cada série ativa, as datas que a regra manda
// existir nos próximos dias têm que existir no banco. Não importa por que o gerador parou
// (coluna, erro de parse, cron morto) — se a data não está lá, a série está com fome.
// PURA: recebe os moldes, os dias já materializados e o gerador de ocorrências.

const DIA = 86400000;

function _dia(ts) {
  if (!ts) return null;
  return typeof ts === 'string' ? ts.slice(0, 10) : new Date(ts).toISOString().slice(0, 10);
}

/**
 * @param {{
 *   moldes: Array<{id:string, table:'tasks'|'events', title?:string, recurrence_rule:string,
 *                  due_date?:string, start_at?:string, created_at?:string}>,
 *   diasPorMolde: Map<string, string[]>,   // id do molde → dias (YYYY-MM-DD, UTC) já materializados
 *   agoraMs: number,
 *   janelaDias?: number,
 *   idadeMinimaMs?: number,                 // molde novo ainda não passou pelo gerador
 *   proximas: (rule:string, dtstart:Date, de:Date, ate:Date, max:number) => Date[],
 * }} args
 * @returns {Array<{id:string, table:string, title:string, faltam:number}>}
 */
function seriesFamintas({ moldes, diasPorMolde, agoraMs, janelaDias = 7, idadeMinimaMs = DIA, proximas }) {
  const out = [];
  const de = new Date(agoraMs);
  const ate = new Date(agoraMs + janelaDias * DIA);
  const dias = diasPorMolde instanceof Map ? diasPorMolde : new Map();
  for (const m of (Array.isArray(moldes) ? moldes : [])) {
    if (!m || !m.id || !m.recurrence_rule) continue;
    const criado = m.created_at ? Date.parse(m.created_at) : NaN;
    if (Number.isFinite(criado) && agoraMs - criado < idadeMinimaMs) continue;
    const dtstart = m.table === 'tasks'
      ? new Date(String(m.due_date) + 'T12:00:00-03:00')
      : new Date(m.start_at);
    if (isNaN(dtstart.getTime())) continue;
    let occ;
    try { occ = proximas(m.recurrence_rule, dtstart, de, ate, 50) || []; } catch (_) { continue; }
    const tem = new Set(dias.get(m.id) || []);
    const proprio = _dia(m.table === 'tasks' ? m.due_date : m.start_at);
    if (proprio) tem.add(proprio);
    const faltam = occ.map((d) => d.toISOString().slice(0, 10)).filter((k) => !tem.has(k));
    if (faltam.length) out.push({ id: m.id, table: m.table, title: m.title || '(sem título)', faltam: faltam.length });
  }
  return out;
}

module.exports = { seriesFamintas };
