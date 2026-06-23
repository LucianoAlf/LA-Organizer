// src/utils/adherence-projects.js
// Classificação dos projetos do "balanço de aderência" (dispatcher).
// Caso Matheus 22/06: um projeto cujas tarefas estão TODAS concluídas estava sendo cobrado
// como "parado / Reagenda? Cancela?". Aqui separamos:
//   - "parado"        → ainda tem trabalho ABERTO do collab, sem atividade há > cutoff
//   - "pronto pra fechar" → tarefas do collab já concluídas, mas o projeto segue 'active'
// Função pura (recebe os dados já buscados) — testável sem Supabase.

// Diferença em dias inteiros entre dois YMD (absoluta, sem fuso).
function ymdDaysBetween(ymd1, ymd2) {
  const [y1, m1, d1] = ymd1.split('-').map(Number);
  const [y2, m2, d2] = ymd2.split('-').map(Number);
  return Math.abs(Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000));
}

// activeProjects: [{ id, name, status }]
// collabTasks:    [{ project_id, updated_at, status }]  (tarefas DO collab nesses projetos)
// cutoffIso:      ISO string — só entra projeto cuja última task do collab é < cutoff
// ymdToday:       'YYYY-MM-DD'
// Retorna { pausedProjects, readyProjects } — cada um [{ id, name, last_update, days_since }],
// ordenado por days_since desc.
function classifyAdherenceProjects(activeProjects, collabTasks, cutoffIso, ymdToday) {
  const byProj = new Map(); // project_id -> { last, hasOpen, hasDone }
  for (const t of (collabTasks || [])) {
    if (!t || !t.project_id || !t.updated_at) continue;
    let e = byProj.get(t.project_id);
    if (!e) { e = { last: null, hasOpen: false, hasDone: false }; byProj.set(t.project_id, e); }
    if (!e.last || e.last < t.updated_at) e.last = t.updated_at;
    if (t.status === 'done') e.hasDone = true;
    else if (t.status !== 'cancelled') e.hasOpen = true;
  }

  const pausedProjects = [];
  const readyProjects = [];
  for (const p of (activeProjects || [])) {
    const e = byProj.get(p.id);
    if (!e || !e.last) continue;        // collab não tem task nesse projeto
    if (e.last >= cutoffIso) continue;  // teve atividade recente — não cobra
    const row = {
      id: p.id,
      name: p.name,
      last_update: e.last,
      days_since: ymdDaysBetween(ymdToday, String(e.last).slice(0, 10)),
    };
    if (e.hasOpen) pausedProjects.push(row);
    else if (e.hasDone) readyProjects.push(row);
    // só cancelled (nem done nem aberta) → ignora
  }
  pausedProjects.sort((a, b) => b.days_since - a.days_since);
  readyProjects.sort((a, b) => b.days_since - a.days_since);
  return { pausedProjects, readyProjects };
}

module.exports = { classifyAdherenceProjects, ymdDaysBetween };
