// src/services/group-report-builder.js
// B1 — Relatórios sob demanda no grupo. Builder DETERMINÍSTICO: o código monta as listas
// exatas; o LLM nunca escreve a lista. Fuso fixo America/Sao_Paulo = UTC-3 (Brasil sem
// horário de verão desde 2019), então usamos offset literal -03:00 (sem toISOString().slice).

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Y-M-D local de São Paulo para um Date.
function spYmd(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date); // 'YYYY-MM-DD'
}

// Soma dias a um 'YYYY-MM-DD' (UTC-safe via meio-dia).
function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Dia da semana (0=Dom..6=Sáb) de um 'YYYY-MM-DD' em SP.
function weekdayYmd(ymd) {
  return new Date(`${ymd}T12:00:00-03:00`).getUTCDay();
}

// Janela em SP. Retorna { start, end (ISO com -03:00), label }. Default = mes.
function windowBounds(window, now) {
  const today = spYmd(now);
  const [y, m] = today.split('-');
  if (window === 'hoje') {
    return { start: `${today}T00:00:00-03:00`, end: `${today}T23:59:59-03:00`, label: 'hoje' };
  }
  if (window === 'semana') {
    const dow = weekdayYmd(today);
    const back = dow === 0 ? 6 : dow - 1;
    const monday = addDaysYmd(today, -back);
    const sunday = addDaysYmd(monday, 6);
    return { start: `${monday}T00:00:00-03:00`, end: `${sunday}T23:59:59-03:00`, label: 'esta semana' };
  }
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const dd = String(lastDay).padStart(2, '0');
  return { start: `${y}-${m}-01T00:00:00-03:00`, end: `${y}-${m}-${dd}T23:59:59-03:00`, label: MESES[Number(m) - 1] };
}

// Marca o prazo de uma tarefa relativo a hoje (YMD): atrasada / esta semana / nada.
function dueFlag(dueYmd, todayYmd) {
  if (!dueYmd) return '';
  if (dueYmd < todayYmd) return '🔴 atrasada';
  if (dueYmd <= addDaysYmd(todayYmd, 7)) return '⏰ esta semana';
  return '';
}

// Separa tarefas em com-prazo (ordenadas por due_date) e sem-prazo.
function splitTasks(tasks) {
  const comPrazo = (tasks || []).filter((t) => t.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const semPrazo = (tasks || []).filter((t) => !t.due_date);
  return { comPrazo, semPrazo };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Card HTML. sections: [{ emoji, title, items: [string] }]. Seção vazia → "(nada no período)".
function renderReportHtml({ groupName, windowLabel, sections }) {
  const blocks = (sections || []).map((s) => {
    const body = (s.items && s.items.length)
      ? `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : `<p>(nada no período)</p>`;
    return `<h3>${s.emoji} ${esc(s.title)}</h3>${body}`;
  }).join('');
  return `<div><h3>📊 Relatório do ${esc(groupName)} — ${esc(windowLabel)}</h3>${blocks}</div>`;
}

// ── I/O ──────────────────────────────────────────────────────────────────────

// Lê TODAS as tarefas abertas do grupo (sem limit que trunque). Resolve nome do responsável.
async function queryGroupTasks(supabase, groupId) {
  const { data } = await supabase.from('tasks')
    .select('id, title, due_date, status, created_by, ' +
            'creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
    .eq('assigned_group_id', groupId).neq('status', 'done')
    .order('due_date', { ascending: true, nullsFirst: false });
  return (data || []).map((t) => ({
    title: t.title,
    due_date: t.due_date,
    responsavel: t.creator?.preferred_name || t.creator?.full_name || null,
  }));
}

// v1: notes e op_checklists NÃO têm vínculo de grupo no schema (sem assigned_group_id).
// Retornam vazio (degrada gracioso). Group-linkage = enhancement futuro (ex.: notes via
// note_task_links → tasks do grupo). Agenda+tarefas são o núcleo do v1.
async function queryGroupNotes(_supabase, _groupId) { return []; }
async function queryGroupChecklists(_supabase, _groupId) { return []; }

// Item de tarefa formatado: "12/06 ⏰ esta semana — Título (Resp)".
function taskLine(t, todayYmd) {
  const d = t.due_date ? `${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : '';
  const flag = dueFlag(t.due_date, todayYmd);
  const head = [d, flag].filter(Boolean).join(' ');
  const resp = t.responsavel ? ` (${t.responsavel})` : '';
  return `${head ? head + ' — ' : ''}${t.title}${resp}`;
}

// Monta o relatório. scope ∈ agenda|tarefas|anotacoes|checklists|tudo. Degrada gracioso.
async function buildGroupReport({ supabase, groupId, scope = 'tudo', window = 'mes', now = new Date() }) {
  const bounds = windowBounds(window, now);
  const todayYmd = spYmd(now);
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  const groupName = g?.name || 'grupo';

  let tasks = [];
  try { tasks = await queryGroupTasks(supabase, groupId); } catch (e) { console.error('[Report] tasks err:', e.message); }
  const { comPrazo, semPrazo } = splitTasks(tasks);
  const startYmd = bounds.start.slice(0, 10);
  const endYmd = bounds.end.slice(0, 10);
  const agenda = comPrazo.filter((t) => t.due_date >= startYmd && t.due_date <= endYmd);

  const sections = [];
  // 'tudo' = Agenda (datadas no período) + Sem prazo (evita repetir as datadas).
  // 'tarefas' = TODAS com prazo (qualquer data) + Sem prazo. 'agenda' = só as datadas no período.
  if (scope === 'agenda' || scope === 'tudo') {
    sections.push({ emoji: '📅', title: `Agenda (${bounds.label})`, items: agenda.map((t) => taskLine(t, todayYmd)) });
  }
  if (scope === 'tarefas') {
    sections.push({ emoji: '✅', title: 'Tarefas com prazo', items: comPrazo.map((t) => taskLine(t, todayYmd)) });
  }
  if (scope === 'tarefas' || scope === 'tudo') {
    sections.push({ emoji: '🗓️', title: 'Tarefas sem prazo', items: semPrazo.map((t) => taskLine(t, todayYmd)) });
  }
  const want = (s) => scope === 'tudo' || scope === s;
  if (want('anotacoes')) {
    let notes = [];
    try { notes = await queryGroupNotes(supabase, groupId); } catch (e) { console.error('[Report] notes err:', e.message); }
    if (notes.length) sections.push({ emoji: '📝', title: 'Anotações', items: notes });
  }
  if (want('checklists')) {
    let cl = [];
    try { cl = await queryGroupChecklists(supabase, groupId); } catch (e) { console.error('[Report] checklists err:', e.message); }
    if (cl.length) sections.push({ emoji: '☑️', title: 'Checklists', items: cl });
  }
  if (!sections.length) sections.push({ emoji: '🎉', title: 'Tudo limpo', items: [] });
  return { html: renderReportHtml({ groupName, windowLabel: bounds.label, sections }) };
}

module.exports = {
  windowBounds, dueFlag, spYmd, addDaysYmd, splitTasks, renderReportHtml,
  queryGroupTasks, queryGroupNotes, queryGroupChecklists, taskLine, buildGroupReport,
};
