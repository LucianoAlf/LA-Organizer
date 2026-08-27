// src/services/group-report-builder.js
// B1/B2 — Relatórios do grupo. Builder DETERMINÍSTICO: o código monta as listas exatas;
// o LLM nunca escreve a lista. Fuso fixo America/Sao_Paulo = UTC-3 (Brasil sem DST desde
// 2019), offset literal -03:00 (sem toISOString().slice). Agrupa por URGÊNCIA em blocos
// (Atrasadas / Para hoje / Esta semana / Mais pra frente / Sem prazo) separados por <hr>.

const { packagePrefix } = require('../utils/group-task-relay'); // fonte única do prefixo "Pacote: "

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
// createdYmd (opcional): se a tarefa foi CRIADA depois do vencimento (lançamento retroativo),
// NÃO é atraso de verdade — ninguém deixou vencer, foi cadastrada já vencida → 'retroativa'
// (categoria não-exibida; some do relatório de cobrança).
function categorize(dueYmd, todayYmd, createdYmd) {
  if (!dueYmd) return 'sem_prazo';
  if (dueYmd < todayYmd) {
    if (createdYmd && createdYmd > dueYmd) return 'retroativa';
    return 'atrasada';
  }
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

// Linha de tarefa SEM flag de urgência (o bloco já diz a categoria): "12/06 — Pacote: Título (Resp)".
// Sem pacote → "12/06 — Título (Resp)"; sem prazo → "Título (Resp)".
function taskLineItem(t) {
  const d = t.due_date ? `${t.due_date.slice(8, 10)}/${t.due_date.slice(5, 7)}` : '';
  const resp = t.responsavel ? ` (${t.responsavel})` : '';
  const pkg = packagePrefix(t.packageTitle, t.title);
  return `${d ? d + ' — ' : ''}${pkg}${t.title}${resp}`;
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
function renderReportHtml({ groupName, windowLabel, sections, heading, emptyMessage }) {
  const title = heading ? heading : `📊 Relatório do ${groupName}${windowLabel ? ' — ' + windowLabel : ''}`;
  const visible = (sections || []).filter((s) => s.items && s.items.length);
  if (!visible.length) {
    // Vazio: mensagem calorosa do preset (já é HTML) que ainda convida a lançar pendências
    // esquecidas. Sem ela (B1 sob demanda), cai no genérico.
    if (emptyMessage) return `<div>${emptyMessage}</div>`;
    return `<div><h3>${esc(title)}</h3><p>🎉 Tudo limpo por aqui — nada pendente.</p></div>`;
  }
  const blocks = visible.map((s) =>
    `<h3>${s.emoji} ${esc(s.title)} · ${s.items.length}</h3>`
    + `<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`,
  ).join('<hr>');
  return `<div><h3>${esc(title)}</h3>${blocks}</div>`;
}

// ── I/O ──────────────────────────────────────────────────────────────────────

// Remove duplicatas EXATAS (mesma tarefa materializada 2x): título + due_date + responsável.
function dedupeTasks(tasks) {
  const seen = new Set();
  return (tasks || []).filter((t) => {
    const k = `${t.title}|${t.due_date || ''}|${t.responsavel || ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Pendente com GÊMEA concluída (mesmo título+due) = sobra de churn de recorrência (o trabalho
// foi feito na OUTRA linha) → não é atraso de verdade. Cancelada NÃO suprime (a pendente pode
// ser a real ainda aberta). Recebe linhas cruas {status,title,due_date}; devolve só as ABERTAS.
function dropOpenWithDoneTwin(rows) {
  const doneKeys = new Set();
  for (const t of (rows || [])) {
    if (t.status === 'done') doneKeys.add(`${t.title}|${t.due_date || ''}`);
  }
  return (rows || []).filter((t) =>
    t.status !== 'done' && t.status !== 'cancelled' && !doneKeys.has(`${t.title}|${t.due_date || ''}`));
}

// Modela linhas CRUAS de tarefa em itens de listagem ABERTOS aplicando TODOS os filtros que
// QUALQUER lugar que mostra tarefa de grupo deve aplicar (regra: digest, card de fechamento e
// pool do chat — todos idênticos):
//   • done → dropOpenWithDoneTwin; cancelled já sai na query.
//   • pendente-gêmea-de-concluída (sobra de churn de recorrência) → dropOpenWithDoneTwin.
//   • RETROATIVA (criada DEPOIS do vencimento, ex.: "Conciliação 01/06" criada 13/06) → some.
//     ANTES isso só rodava no buildGroupReport (digest da manhã, via categorize); o card de
//     fechamento chamava queryGroupTasks DIRETO e mostrava a retroativa como "Em aberto"
//     (tarefa fantasma — caso Rose 20/06, GROUPCHAT-CLOSING-RETRO-PHANTOM).
//   • dedup defensivo de gêmeas exatas (materialização duplicada).
// parentTitleById (opcional): Map id→título dos containers de pacote, pra resolver o nome do pacote
// na filha (parent_task_id) e exibir "Depósito de Cheques: Venc 05...". Ausente → packageTitle null
// (chamadores antigos preservados).
function shapeOpenTasks(rows, todayYmd, parentTitleById) {
  // Container de PACOTE (is_group) NÃO é tarefa — é uma pasta. Listá-lo na lista plana fazia o
  // "Conciliação de Cartões 01/0X" virar tarefa fantasma dia-1 (caso Rose). As tarefas reais são
  // os FILHOS (cartões) + avulsas. No desktop o pacote aparece à parte (fetchPackages).
  const tasksOnly = (rows || []).filter((t) => t.is_group !== true);
  return dedupeTasks(
    dropOpenWithDoneTwin(tasksOnly)
      .map((t) => ({
        title: t.title,
        due_date: t.due_date,
        created_ymd: t.created_at ? spYmd(new Date(t.created_at)) : null,
        responsavel: t.creator?.preferred_name || t.creator?.full_name || null,
        packageTitle: (parentTitleById && t.parent_task_id && parentTitleById.get(t.parent_task_id)) || null,
      }))
      .filter((t) => categorize(t.due_date, todayYmd, t.created_ymd) !== 'retroativa'),
  );
}

// Tarefas ABERTAS do grupo. Esconde: (a) a subtarefa-do-MOLDE de pacote (parent = container
// template) via filterVisibleGroupTasks — o MESMO helper do contexto do TOM (system.js) e do PWA;
// (b) qualquer molde de recorrência (recurrence_rule != null — template avulso E container) via
// filtro JS (preserva o comportamento do antigo .is(rule,null)). Sem (a), a subtarefa-do-molde
// vazava junto com a do ciclo → tarefa em DOBRO quando um reschedule separava as datas
// (GROUPREPORT-MOLDE-CICLO-TWIN, Venc 20 da Rose). O resto (done-twin, retroativa, dedup, container
// de ciclo is_group) é shapeOpenTasks — fonte única. A query traz os containers (sem .is(rule,null))
// pra o helper montar o set de templates. `now` = "hoje" determinístico (default = agora).
async function queryGroupTasks(supabase, groupId, now = new Date()) {
  const { filterVisibleGroupTasks, idsDeMoldeDosPais } = require('../utils/group-task-visibility');
  const { data } = await supabase.from('tasks')
    .select('id, title, due_date, status, is_group, recurrence_rule, recurrence_parent_id, parent_task_id, ' +
            'is_recurrence_template, created_by, created_at, ' +
            'creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)')
    .eq('assigned_group_id', groupId)
    .neq('status', 'cancelled')
    // CTX-READERS-DIVERGEM (27/08): `health-check` filtra `data_classification='real'` no eixo de
    // grupo e este leitor não filtrava — 6 tarefas `archived` contavam pra um e não pro outro.
    // NÃO era latente: "Vídeos de Boas Vindas" (08/08, Yuri) vinha sendo relatada como ATRASADA no
    // grupo MKT há 19 dias, arquivada. Comparação em produção nos 13 grupos: só essa linha sai; os
    // outros 12 grupos ficam idênticos. É a mesma família de "atrasada fantasma" do done-twin.
    // NÃO entra nos resolvedores do chat (group-chat-tasks/engine) de propósito: lá, esconder faria
    // o completer não achar uma tarefa que a pessoa nomeou — o mal maior é "não achei", não relatar.
    .eq('data_classification', 'real')
    .order('due_date', { ascending: true, nullsFirst: false });
  // Map id→título dos CONTAINERS de pacote (is_group) — resolve o nome do pacote na filha
  // (parent_task_id) SEM query extra: o container vem no MESMO result set (mesmo assigned_group_id,
  // status != cancelled). Montado do data CRU, antes de o container sair no filtro is_group.
  const parentTitleById = new Map();
  for (const t of (data || [])) {
    if (t.is_group === true && t.id) parentTitleById.set(t.id, t.title);
  }
  // GROUPPKG-FILHA-TEMPLATE-VAZA-MOLDE-CANCELADO (Rose 12/08): o `.neq('status','cancelled')`
  // acima tira o molde CANCELADO do result set, e sem ele o helper não tem como saber que as
  // filhas dele são fantasmas. Os ids vêm do banco, sem filtro de status.
  const idsMolde = await idsDeMoldeDosPais(supabase, data || []);
  const visible = filterVisibleGroupTasks(data || [], idsMolde).filter((t) => t.recurrence_rule == null);
  return shapeOpenTasks(visible, spYmd(now), parentTitleById);
}

// Fichas do grupo (não-deletadas) com quem mexeu por último — pra auditoria/listagem.
async function queryGroupNotes(supabase, groupId) {
  const { data } = await supabase.from('group_notes')
    .select('title, type, updated_at, updater:collaborators!group_notes_updated_by_fkey(preferred_name, full_name)')
    .eq('group_id', groupId).is('deleted_at', null)
    .order('updated_at', { ascending: false });
  return (data || []).map((n) => ({
    title: n.title, type: n.type, updated_at: n.updated_at,
    quem: n.updater?.preferred_name || n.updater?.full_name || null,
  }));
}
// op_checklists ainda NÃO têm vínculo de grupo no schema → stub (degrada gracioso).
async function queryGroupChecklists(_supabase, _groupId) { return []; }

// Monta o relatório em blocos por urgência. scope ∈ agenda|tarefas|tudo (agenda = sem bloco
// "sem prazo"). window ∈ hoje|semana|mes controla até onde vai. onlyOverdue = só atrasadas.
async function buildGroupReport({ supabase, groupId, scope = 'tudo', window = 'mes', now = new Date(), heading = null, onlyOverdue = false, emptyMessage = null }) {
  const bounds = windowBounds(window, now);
  const todayYmd = spYmd(now);
  const { data: g } = await supabase.from('work_groups').select('name').eq('id', groupId).maybeSingle();
  const groupName = g?.name || 'grupo';

  let tasks = [];
  try { tasks = await queryGroupTasks(supabase, groupId, now); } catch (e) { console.error('[Report] tasks err:', e.message); }

  // Cobrança de atrasadas (B2 overdue): bloco único, short-circuit se vazio.
  if (onlyOverdue) {
    const overdue = (tasks || []).filter((t) => categorize(t.due_date, todayYmd, t.created_ymd) === 'atrasada')
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const sections = [{ emoji: '🔴', title: 'Tarefas atrasadas', items: overdue.map(taskLineItem) }];
    return { html: renderReportHtml({ groupName, windowLabel: bounds.label, sections, heading }), isEmpty: overdue.length === 0 };
  }

  // Distribui as tarefas nos blocos que a janela pede.
  const wanted = catsForWindow(window, scope);
  const endYmd = bounds.end.slice(0, 10);
  const buckets = Object.fromEntries(wanted.map((c) => [c, []]));
  for (const t of (tasks || [])) {
    const cat = categorize(t.due_date, todayYmd, t.created_ymd);
    if (!wanted.includes(cat)) continue; // 'retroativa' (lançada já vencida) cai aqui → fora do relatório
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
  return { html: renderReportHtml({ groupName, windowLabel: bounds.label, sections, heading, emptyMessage }), isEmpty: itemCount === 0 };
}

module.exports = {
  windowBounds, dueFlag, categorize, catsForWindow, spYmd, addDaysYmd, splitTasks, dedupeTasks, dropOpenWithDoneTwin,
  renderReportHtml, shapeOpenTasks, queryGroupTasks, queryGroupNotes, queryGroupChecklists,
  taskLine, taskLineItem, buildGroupReport, CATEGORIES,
};
