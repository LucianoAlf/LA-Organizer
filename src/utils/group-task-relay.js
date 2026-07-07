'use strict';
// Formatação pura de tarefas de GRUPO (pool) p/ as superfícies do TOM: contexto do prompt
// (buildGroupPoolLines) e lembrete de WhatsApp (buildGroupTaskReminderText). Sem I/O — o
// caller injeta os dados (já com join do criador) e o fmtDate. Nasce de NOTE: o pool não
// levava descrição/autor (context-gap) → membro só via título e TOM dizia "não sei quem criou".

function firstNameOf(person) {
  if (!person) return '';
  const n = person.preferred_name || person.full_name || '';
  return String(n).trim().split(/\s+/)[0] || '';
}

function truncDesc(text, max) {
  const d = String(text || '').trim().replace(/\s+/g, ' ');
  if (!d) return '';
  return d.length > max ? d.slice(0, max) + '…' : d;
}

// Normaliza pra comparação de contenção (lower + colapsa espaço).
function _normCmp(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Prefixo "Pacote: " quando a tarefa é filha de um PACOTE (parent_task_id → container is_group).
// COMPARTILHADO por todas as superfícies que listam tarefa de grupo (digest/card via
// group-report-builder.taskLineItem; pool 1:1 via buildGroupPoolLines; pool do chat via
// group-chat-prompt.fmtPoolLine) — fonte única, sem divergência (GROUPREPORT-PACKAGE-TITLE-MISSING).
// Guard: se o título já cita o pacote, não duplica ("Venc 20: Venc 20").
function packagePrefix(packageTitle, title) {
  if (!packageTitle) return '';
  if (_normCmp(title).includes(_normCmp(packageTitle))) return '';
  return `${packageTitle}: `;
}

// Espelha o padrão do renderTaskList (system.js:462) p/ as tarefas de pool do membro.
// fmtDate(dueYmd, today) injetado (formatRelativeDate) p/ manter puro.
// parentTitleById (opcional): Map id→título dos containers de pacote, pra prefixar o nome do
// pacote na filha ("Depósito de Cheques: Venc 05..."). Ausente → sem prefixo (regressão preservada).
function buildGroupPoolLines(tasks, groups, today, fmtDate, parentTitleById) {
  const out = [];
  const list = Array.isArray(tasks) ? tasks : [];
  const gs = Array.isArray(groups) ? groups : [];
  for (const t of list) {
    if (!t) continue;
    const g = gs.find((x) => x && x.id === t.assigned_group_id);
    const sid = String(t.id || '').slice(0, 8);
    const due = t.due_date ? ` — ${(fmtDate && fmtDate(t.due_date, today)) || t.due_date}` : '';
    const cn = firstNameOf(t.creator);
    const by = cn ? ` · criada por ${cn}` : '';
    const pkg = packagePrefix(parentTitleById && t.parent_task_id && parentTitleById.get(t.parent_task_id), t.title);
    out.push(`• [id=${sid}] 👥[${g ? g.name : 'grupo'}] ${pkg}${t.title}${due}${by}`);
    const desc = truncDesc(t.description, 240);
    if (desc) out.push(`   ↳ ${desc}`);
  }
  return out;
}

// Sufixo "autor + descrição curta" COMPARTILHADO pelas superfícies de lembrete de grupo
// (DRY entre checkTaskReminders e remindGroupTasks). Retorna '' quando não há autor nem
// descrição. Omite gracioso (criador ausente nunca quebra o lembrete).
function groupAuthorDescSuffix({ creatorFirstName, description, max = 200 } = {}) {
  const desc = truncDesc(description, max);
  const by = creatorFirstName ? `criada por ${creatorFirstName}` : '';
  let s = '';
  if (desc && by) s = `\n_${by}:_ ${desc}`;
  else if (desc) s = `\n${desc}`;
  else if (by) s = `\n_${by}_`;
  if (desc && String(description || '').trim().length > max) s += '\n_abre no app pra ver tudo_';
  return s;
}

// 1ª linha = formato atual (intocado p/ não regredir o que já funciona) + sufixo autor/descrição.
// packageTitle (filha de pacote) → prefixo "Pacote: " dentro do bold (GROUPREPORT-PACKAGE-TITLE-MISSING).
function buildGroupTaskReminderText({ label, title, when, creatorFirstName, description, packageTitle } = {}) {
  const lab = label ? `${label}: ` : 'Lembrete: ';
  const pkg = packagePrefix(packageTitle, title);
  const head = `⏰ ${lab}*${pkg}${title}* (grupo)${when ? ` — ${when}` : ''}`;
  return head + groupAuthorDescSuffix({ creatorFirstName, description });
}

module.exports = { buildGroupPoolLines, buildGroupTaskReminderText, groupAuthorDescSuffix, firstNameOf, truncDesc, packagePrefix };
