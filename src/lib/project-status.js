'use strict';
// Helper PURO do fechar/cancelar projeto por chat (testável sem Supabase, padrão
// adherence-projects.js). Resolve projeto, checa autoridade, conta abertas e monta textos.
// KRISSYA-PROJECT-CLOSE-NO-HANDLER (auditoria 30/06).

const ALIVE_STATUSES = new Set(['pending_approval', 'planning', 'active', 'paused']);
const STATUS_BY_ACTION = { complete: 'completed', cancel: 'cancelled' };

function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
const _cand = (p) => ({ id: p.id, name: p.name });

function resolveProjectByName(aliveProjects, nameHint, quotedText) {
  const projects = (aliveProjects || []).filter((p) => p && p.id && p.name);
  if (!projects.length) return { status: 'none' };

  const hint = _norm(nameHint);
  if (hint) {
    const exact = projects.filter((p) => _norm(p.name) === hint);
    if (exact.length === 1) return { status: 'match', project: exact[0] };
    if (exact.length > 1) return { status: 'ambiguous', candidates: exact.map(_cand) };
    const contains = projects.filter((p) => {
      const n = _norm(p.name);
      return n.includes(hint) || hint.includes(n);
    });
    if (contains.length === 1) return { status: 'match', project: contains[0] };
    if (contains.length > 1) return { status: 'ambiguous', candidates: contains.map(_cand) };
    return { status: 'none' };
  }

  const q = _norm(quotedText);
  if (q) {
    const inQuote = projects.filter((p) => q.includes(_norm(p.name)));
    if (inQuote.length === 1) return { status: 'match', project: inQuote[0] };
    if (inQuote.length > 1) return { status: 'ambiguous', candidates: inQuote.map(_cand) };
  }
  return { status: 'none' };
}

function canChangeStatus(collab, project, leaderIds) {
  if (!collab || !project) return false;
  if (project.created_by && project.created_by === collab.id) return true;
  return Array.isArray(leaderIds) && leaderIds.includes(collab.id);
}

function summarizeOpenWork(openTasks) {
  const open = (openTasks || []).filter((t) => t && t.status !== 'done' && t.status !== 'cancelled');
  const byName = new Map();
  for (const t of open) {
    const name = String(t.assignee_name || 'sem responsável').trim() || 'sem responsável';
    byName.set(name, (byName.get(name) || 0) + 1);
  }
  const byPerson = [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { total: open.length, byPerson };
}

const _verbConfirm = (action) => (action === 'cancel' ? 'Cancelo' : 'Fecho');
const _plural = (n) => (n === 1 ? 'tarefa aberta' : 'tarefas abertas');

function buildStatusConfirm(project, action, openSummary) {
  const head = `${_verbConfirm(action)} o projeto *${project.name}*?`;
  const s = openSummary || { total: 0, byPerson: [] };
  if (!s.total) return action === 'cancel' ? head : `${head} 🎉`;
  const people = s.byPerson.map((p) => p.name).slice(0, 4).join(', ');
  return `⚠️ Ainda tem ${s.total} ${_plural(s.total)} (${people}).\n\n${head}`;
}

function buildStatusResult(project, action, openSummary) {
  const s = openSummary || { total: 0, byPerson: [] };
  const head = action === 'cancel'
    ? `Projeto *${project.name}* cancelado.`
    : `✅ Projeto *${project.name}* concluído!`;
  if (s.total) return `${head}\n\n_Deixei as ${s.total} ${_plural(s.total)} como estavam._`;
  return head;
}

module.exports = {
  resolveProjectByName, canChangeStatus, summarizeOpenWork,
  buildStatusConfirm, buildStatusResult, STATUS_BY_ACTION, ALIVE_STATUSES, _norm,
};
