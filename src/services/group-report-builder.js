// src/services/group-report-builder.js
// B1/B2 — Relatórios do grupo. Builder DETERMINÍSTICO: o código monta as listas exatas;
// o LLM nunca escreve a lista. Fuso fixo America/Sao_Paulo = UTC-3 (Brasil sem DST desde
// 2019), offset literal -03:00 (sem toISOString().slice). Agrupa por URGÊNCIA em blocos
// (Atrasadas / Para hoje / Esta semana / Mais pra frente / Sem prazo) separados por <hr>.

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

// Marca o prazo relativo a hoje (legado — usado por outros consumidores/testes).
function dueFlag(dueYmd, todayYmd) {
  if (!dueYmd) return '';
  if (dueYmd < todayYmd) return '🔴 atrasada';
  if (dueYmd <= addDaysYmd(todayYmd, 7)) return '⏰ esta semana';
  return '';
}

// ── Categorias de urgência (cada uma vira um BLOCO no relatório) ───────────────
const CATEGORIES = [
  { key: 'atrasada',  emoji: '🔴', title: 'Atrasadas' },
  { key: 'hoje',      emoji: '📌', title: 'Para hoje' },
  { key: 'semana',    emoji: '⏰', title: 'Esta semana' },
  { key: 'futura',    emoji: '📅', title: 'Mais pra frente' },
  { key: 'sem_prazo', emoji: '📝', title: 'Sem prazo definido' },
];

// Categoriza uma tarefa pela data de vencimento relativa a hoje (YMD lexicográfico = cronológico).
function categorize(dueYmd, todayYmd) {
  if (!dueYmd) return 'sem_prazo';
  if (dueYmd < todayYmd) return 'atrasada';
  if (dueYmd === todayYmd) return 'hoje';
  if (dueYmd <= addDaysYmd(todayYmd, 7)) return 'semana';
  return 'futura';
}

// Quais blocos cada janela mostra. Atrasadas/hoje entram sempre; semana/futura/sem-prazo
// conforme o alcance. 'agenda' (só datadas) não inclui sem-prazo.
function catsForWindow(window, scope) {
  if (window === 'hoje') return ['atrasada', 'hoje'];
  if (window === 'semana') return ['atrasada', 'hoje', 'semana'];
  const cats = ['atrasada', 'hoje', 'semana', 'futura'];
  if (scope !== 'agenda') cats.push('sem_prazo');
  return cats;
}

// Separa tarefas em com-prazo (ordenadas) e sem-prazo (legado — exportado/testes).
function splitTasks(tasks) {
  const comPrazo = (tasks || []).filter((t) => t.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const semPrazo = (tasks || []).filter((t) => !t.due_date);
  return { comPrazo, semPrazo };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Linha de tarefa SEM flag de urgência (o bloco já diz a categoria): "12/06 — Título (Resp)".
// Sem prazo → "Título (Resp)".
function taskLineItem(t) {
  const d = t.due_date ? `${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : '';
  const resp = t.responsavel ? ` (${t.responsavel})` : '';
  return `${d ? d + ' — ' : ''}${t.title}${resp}`;
}

// Linha COM flag (legado — exportado/testes).
function taskLine(t, todayYmd) {
  const d = t.due_date ? `${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : '';
  const flag = dueFlag(t.due_date, todayYmd);
  const head = [d, flag].filter(Boolean).join(' ');
  const resp = t.responsavel ? ` (${t.responsavel})` : '';
  return `${head ? head + ' — ' : ''}${t.title}${resp}`;
}

// Card HTML por BLOCOS. sections: [{ emoji, title, items: [string] }]. Blocos vazios somem;
// blocos separados por <hr> (vira linha de traços no WhatsApp). Título de bloco leva a contagem.
function renderReportHtml({ groupName, windowLabel, sections, heading }) {
  const title = heading ? heading : `📊 Relatório do ${groupName}${windowLabel ? ' — ' + windowLabel : ''}`;
  const visible = (sections || []).filter((s) => s.items && s.items.length);
  if (!visible.length) {
    return `<div><h3>${esc(title)}</h3><p>🎉 Tudo limpo por aqui — nada pendente.</p></div>`;
  }
  const blocks = visible.map((s) =>
    `<h3>${s.emoji} ${esc(s.title)} · ${s.items.length}</h3>`
    + `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`,
  ).join('<hr>');
  return `<div><h3>${esc(title)}</h3>${blocks}</div>`;
}

// ── I/O ──────────────────────────────────────────────────────────────────────

// Tarefas ABERTAS do grupo. Exclui done E cancelled (cancelada não é "atrasada"), e esconde
// os MOLDES de recorrência (recurrence_rule != null) — mostra só instâncias e tarefas normais.
async function queryGroupTasks(supabase, groupId) {
  const { data } = await supabase.from('tasks')
    .select('id, title, due_date, status, created_by, ' +
            'creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
    .eq('assigned_group_id', groupId)
    .neq('status', 'done')
    .neq('status', 'cancelled')
    .is('recurrence_rule', null)
    .order('due_date', { ascending: true, nullsFirst: false });
  return (data || []).map((t) => ({
    title: t.title,
    due_date: t.due_date,
    responsavel: t.creator?.preferred_name || t.creator?.full_name || null,
  }));
}

// v1: notes e op_checklists NÃO têm vínculo de grupo no schema. Retornam vazio (degrada gracioso).
async function queryGroupNotes(_supabase, _groupId) { return []; }
async function queryGroupChecklists(_supabase, _groupId) { return []; }

// Monta o relatório em blocos por urgência. scope ∈ agenda|tarefas|tudo (agenda = sem bloco
// "sem prazo"). window ∈ hoje|semana|mes controla até onde vai. onlyOverdue = só atrasadas.
async function buildGroupReport({ supabase, groupId, scope = 'tudo', window = 'mes', now = new Date(), heading = null, onlyOverdue = false }) {
  const bounds = windowBounds(window, now);
  const todayYmd = spYmd(now);
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  const groupName = g?.name || 'grupo';

  let tasks = [];
  try { tasks = await queryGroupTasks(supabase, groupId); } catch (e) { console.error('[Report] tasks err:', e.message); }

  // Cobrança de atrasadas (B2 overdue): bloco único, short-circuit se vazio.
  if (onlyOverdue) {
    const overdue = (tasks || []).filter((t) => t.due_date && t.due_date < todayYmd)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const sections = [{ emoji: '🔴', title: 'Tarefas atrasadas', items: overdue.map(taskLineItem) }];
    return { html: renderReportHtml({ groupName, windowLabel: bounds.label, sections, heading }), isEmpty: overdue.length === 0 };
  }

  // Distribui as tarefas nos blocos que a janela pede.
  const wanted = catsForWindow(window, scope);
  const endYmd = bounds.end.slice(0, 10);
  const buckets = Object.fromEntries(wanted.map((c) => [c, []]));
  for (const t of (tasks || [])) {
    const cat = categorize(t.due_date, todayYmd);
    if (!wanted.includes(cat)) continue;
    if (cat === 'futura' && t.due_date > endYmd) continue; // não vaza além da janela (ex.: próximo mês)
    buckets[cat].push(t);
  }
  for (const c of wanted) {
    buckets[c].sort((a, b) => (c === 'sem_prazo'
      ? String(a.title).localeCompare(String(b.title))
      : String(a.due_date).localeCompare(String(b.due_date))));
  }

  const sections = CATEGORIES
    .filter((c) => wanted.includes(c.key) && buckets[c.key].length)
    .map((c) => ({ emoji: c.emoji, title: c.title, items: buckets[c.key].map(taskLineItem) }));
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  return { html: renderReportHtml({ groupName, windowLabel: bounds.label, sections, heading }), isEmpty: itemCount === 0 };
}

module.exports = {
  windowBounds, dueFlag, categorize, catsForWindow, spYmd, addDaysYmd, splitTasks,
  renderReportHtml, queryGroupTasks, queryGroupNotes, queryGroupChecklists,
  taskLine, taskLineItem, buildGroupReport, CATEGORIES,
};
