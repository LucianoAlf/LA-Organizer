'use strict';
// Handler DETERMINÍSTICO de consulta de tarefas — TASK-QUERY-NO-FULL-LIST (caso Alf 12/06).
//
// PORQUÊ: os contadores (barrinha/scorecard) varrem o banco inteiro e dão o número exato
// ("6 de 12"), mas o contexto do LLM (system.js buildContext) só injeta um RECORTE das
// tarefas (workTasks cortado em max_daily_tasks + due_date<=+7d). Quando o usuário tem 15
// abertas e pergunta "quais minhas atrasadas / o que tenho pra fazer esse mês / lista minhas
// pendentes", o LLM vê parcial, chuta e manda "abre o app". Aqui interceptamos ANTES do LLM:
// detecta a intenção → o engine puxa a lista COMPLETA do banco → renderiza tudo com a
// contagem exata. NUNCA "abre o app".
//
// Espelha os padrões que já funcionam: detector message-anchored (finance/detect-report-intent.js)
// + render determinístico puxando do banco (services/scorecard-builder.js, utils/closing-reply.js).
//
// Funções PURAS (o engine faz I/O e decide o envio):
//   - detectTaskQuery(text)            → {scope} | null
//   - filterTasksByScope(tasks, scope, today)
//   - renderTaskQueryReply(tasks, scope, opts)
//   - helpers de data BRT por string (sem UTC shift — ver known issue localYmd).

const { formatRelativeDate } = require('./dates');

// ───────────────────────────── detector de intenção ─────────────────────────────
//
// Ancoragem de MENSAGEM INTEIRA `^ LEAD (core) $` (igual detect-report-intent): só dispara
// quando a mensagem É a consulta. Isso mata criação ("tenho que fazer o relatório"),
// fechamento ("fiz tudo essa semana") e fala enterrada. CONSERVADOR: sem casar → null,
// o fluxo segue normal pro LLM.

// "pagar/gastei/conta" → é finança; nunca tratamos como tarefa (o roteador de finanças
// roda antes no engine; aqui é cinto-e-suspensório).
const FINANCE_DENY = /\b(pagar|paguei|gastei|gasto|gastos|conta|contas|boleto|fatura|saldo|extrato|dinheiro|grana|receber|recebi)\b/;

const LEAD = '(?:(?:oi|ola|ei|e|ai|tom|por|favor|pf|me|da|de|pra|para|entao|so|queria|quero|preciso|gostaria|manda|mandar|mostra|mostrar|lista|listar|ver|me\\s+ve|diz|fala|traz|enumera)\\s+)*';

function _norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento
    .replace(/[,;]/g, ' ')                    // vírgula/ponto-e-vírgula viram espaço
    .replace(/\s+/g, ' ')
    .trim();
}
function _re(core) { return new RegExp('^' + LEAD + '(?:' + core + ')\\s*[?.!]*$'); }

// Modificadores opcionais comuns em todas as consultas.
const MINHAS = '(?:as\\s+)?(?:minhas?|meus?)?\\s*';   // "minhas", "as minhas", ""
const TAREFAS = '(?:tarefas?|pendencias?|coisas?|afazeres|itens?)';

function detectTaskQuery(text) {
  const t = _norm(text);
  if (!t || t.length > 200) return null;
  if (FINANCE_DENY.test(t)) return null;

  // 1) ATRASADAS / vencidas / fora do prazo
  if (
    _re(MINHAS + TAREFAS + '\\s+(?:atrasad\\w+|vencid\\w+)').test(t) ||
    _re(MINHAS + '(?:atrasad\\w+|vencid\\w+)').test(t) ||
    _re('quais\\s+(?:sao\\s+)?' + MINHAS + '(?:' + TAREFAS + '\\s+)?(?:atrasad\\w+|vencid\\w+)').test(t) ||
    _re('(?:o\\s+que|oq|tudo\\s+que|o\\s+que\\s+e\\s+que)\\s+(?:eu\\s+)?(?:tenho|ta|esta|tem)\\s+(?:de\\s+)?atrasad\\w*').test(t) ||
    _re('(?:o\\s+que|oq)\\s+(?:eu\\s+)?(?:tenho\\s+)?(?:que\\s+)?(?:ta|esta)?\\s*(?:atrasad\\w+|vencid\\w+)').test(t) ||
    _re('(?:o\\s+que|oq)\\s+passou\\s+(?:do|da)\\s+prazo').test(t) ||
    _re(TAREFAS + '\\s+(?:atrasad\\w+|vencid\\w+)').test(t)
  ) return { scope: 'overdue' };

  // 2) SEMANA
  const SEMANA = '(?:essa|esta|dessa|desta|da|na|nessa|nesta|pra\\s+essa|pra\\s+esta|de)\\s+semana';
  if (
    _re('(?:o\\s+que|oq)\\s+(?:eu\\s+)?(?:tenho|tem|preciso\\s+fazer|tenho\\s+(?:que\\s+|pra\\s+|para\\s+)?fazer|tenho\\s+pra)\\s*(?:fazer\\s+)?(?:' + SEMANA + ')').test(t) ||
    _re(MINHAS + TAREFAS + '\\s+(?:' + SEMANA + ')').test(t) ||
    _re(TAREFAS + '\\s+(?:' + SEMANA + ')').test(t) ||
    _re('(?:o\\s+que|oq)\\s+tem\\s+(?:pra|para)\\s+(?:' + SEMANA + ')').test(t)
  ) return { scope: 'week' };

  // 3) MÊS
  const MES = '(?:esse|este|desse|deste|do|no|nesse|neste|pra\\s+esse|pra\\s+este|de)\\s+m[eê]s';
  if (
    _re('(?:o\\s+que|oq)\\s+(?:eu\\s+)?(?:tenho|tem|preciso\\s+fazer|tenho\\s+(?:que\\s+|pra\\s+|para\\s+)?fazer|tenho\\s+pra)\\s*(?:fazer\\s+)?(?:' + MES + ')').test(t) ||
    _re(MINHAS + TAREFAS + '\\s+(?:' + MES + ')').test(t) ||
    _re(TAREFAS + '\\s+(?:' + MES + ')').test(t) ||
    _re('(?:o\\s+que|oq)\\s+tem\\s+(?:pra|para)\\s+(?:' + MES + ')').test(t)
  ) return { scope: 'month' };

  // 4) ABERTAS / pendentes / o que falta (open_all)
  if (
    _re(MINHAS + '(?:pendencias?|pendentes)').test(t) ||
    _re(MINHAS + TAREFAS + '\\s+(?:pendentes?|abertas?|em\\s+aberto)').test(t) ||
    _re(TAREFAS + '\\s+(?:pendentes?|abertas?|em\\s+aberto)').test(t) ||
    _re('(?:o\\s+que|oq|tudo\\s+que)\\s+(?:ta|esta|tem)\\s+(?:em\\s+)?aberto').test(t) ||
    _re('(?:o\\s+que|oq)\\s+falta(?:\\s+fazer)?').test(t) ||
    _re('(?:o\\s+que|oq)\\s+(?:eu\\s+)?(?:tenho|tem)\\s+(?:que\\s+|pra\\s+|para\\s+)?fazer').test(t) ||
    _re('(?:o\\s+que|oq)\\s+(?:eu\\s+)?(?:tenho|tem)(?:\\s+pra\\s+fazer)?').test(t) ||
    _re('quais\\s+(?:sao\\s+)?' + MINHAS + TAREFAS).test(t) ||
    _re(MINHAS + TAREFAS).test(t) // "minhas tarefas", "lista minhas tarefas"
  ) return { scope: 'open_all' };

  return null;
}

// ───────────────────────────── helpers de data (BRT, por string) ─────────────────────────────
// Operam sobre 'YYYY-MM-DD' com âncora ao meio-dia UTC pra nunca cruzar fuso (ver known issue
// localYmd/UTC-shift). Nunca usam toISOString().slice(0,10) sobre a data local.

function _isYMD(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function addDaysYMD(ymd, n) {
  if (!_isYMD(ymd)) return ymd;
  const d = new Date(ymd + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + (Number(n) || 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Domingo da semana civil (segunda → domingo) que contém `today`.
function endOfWeekBRT(today) {
  if (!_isYMD(today)) return today;
  const dow = new Date(today + 'T12:00:00.000Z').getUTCDay(); // 0=dom..6=sab
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  return addDaysYMD(today, daysToSunday);
}

// Último dia do mês de `today`.
function endOfMonthBRT(today) {
  if (!_isYMD(today)) return today;
  const y = parseInt(today.slice(0, 4), 10);
  const m = parseInt(today.slice(5, 7), 10); // 1..12
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // dia 0 do mês seguinte = último deste
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// ───────────────────────────── filtro por escopo ─────────────────────────────

function _due(t) {
  const d = t && t.due_date ? String(t.due_date).slice(0, 10) : null;
  return _isYMD(d) ? d : null;
}

function filterTasksByScope(tasks, scope, today) {
  const arr = Array.isArray(tasks) ? tasks : [];
  if (scope === 'open_all') return arr.slice();
  if (scope === 'overdue') return arr.filter((t) => { const d = _due(t); return d && d < today; });
  if (scope === 'week') { const eow = endOfWeekBRT(today); return arr.filter((t) => { const d = _due(t); return d && d <= eow; }); }
  if (scope === 'month') { const eom = endOfMonthBRT(today); return arr.filter((t) => { const d = _due(t); return d && d <= eom; }); }
  return arr.slice();
}

// ───────────────────────────── render determinístico ─────────────────────────────

const SCOPE_HEADER = {
  overdue: { emoji: '🔴', label: 'atrasada', labelPl: 'atrasadas' },
  week:    { emoji: '📅', label: 'desta semana', labelPl: 'desta semana' },
  month:   { emoji: '🗓️', label: 'deste mês', labelPl: 'deste mês' },
  open_all:{ emoji: '📋', label: 'em aberto', labelPl: 'em aberto' },
};

function _sortByDue(a, b) {
  const da = _due(a), db = _due(b);
  if (da && db) return da < db ? -1 : da > db ? 1 : 0;
  if (da && !db) return -1;
  if (!da && db) return 1;
  return 0;
}

function _line(t, today) {
  const due = _due(t);
  const rel = due ? formatRelativeDate(due, today) : null;
  const title = String(t.title || 'Sem título').trim();
  return rel ? `• ${title} — ${rel}` : `• ${title}`;
}

/**
 * Renderiza a resposta WhatsApp com a lista COMPLETA do escopo, agrupada em
 * atrasadas / com prazo / sem prazo, com contagem exata no cabeçalho.
 * NUNCA inclui "abre o app". `tasks` já vem filtrada pelo escopo (ou passe tudo
 * e use filterTasksByScope antes).
 */
function renderTaskQueryReply(tasks, scope, opts = {}) {
  const today = opts.today;
  const firstName = (opts.firstName || '').trim();
  const hdr = SCOPE_HEADER[scope] || SCOPE_HEADER.open_all;
  const arr = Array.isArray(tasks) ? tasks : [];

  const overdue = arr.filter((t) => { const d = _due(t); return d && d < today; }).sort(_sortByDue);
  const dated   = arr.filter((t) => { const d = _due(t); return d && d >= today; }).sort(_sortByDue);
  const noDue   = arr.filter((t) => !_due(t));
  const total = arr.length;

  // Estado vazio — positivo, nunca "abre o app".
  if (total === 0) {
    if (scope === 'overdue') return `✅ Você não tem nenhuma tarefa atrasada${firstName ? ', ' + firstName : ''} — tá tudo em dia! 🎯`;
    if (scope === 'week') return `✅ Nada com prazo pra esta semana${firstName ? ', ' + firstName : ''}. Semana limpa! 🎯`;
    if (scope === 'month') return `✅ Nada com prazo pra este mês${firstName ? ', ' + firstName : ''}. Mês tranquilo! 🎯`;
    return `✅ Você não tem nenhuma tarefa em aberto${firstName ? ', ' + firstName : ''} — tudo concluído! 🎯`;
  }

  const possNoun = total === 1 ? 'Sua tarefa' : 'Suas tarefas';
  const lbl = total === 1 ? hdr.label : hdr.labelPl;
  const lines = [];
  lines.push(`${hdr.emoji} *${possNoun} ${lbl} (${total}):*`);

  // Para overdue, todas já são atrasadas → uma lista só, sem sub-cabeçalhos.
  if (scope === 'overdue') {
    overdue.forEach((t) => lines.push(_line(t, today)));
  } else {
    if (overdue.length) {
      lines.push('', `🔴 *Atrasadas (${overdue.length}):*`);
      overdue.forEach((t) => lines.push(_line(t, today)));
    }
    if (dated.length) {
      lines.push('', `📅 *Com prazo (${dated.length}):*`);
      dated.forEach((t) => lines.push(_line(t, today)));
    }
    if (noDue.length) {
      lines.push('', `📋 *Sem prazo (${noDue.length}):*`);
      noDue.forEach((t) => lines.push(_line(t, today)));
    }
  }

  return lines.join('\n');
}

module.exports = {
  detectTaskQuery,
  filterTasksByScope,
  renderTaskQueryReply,
  endOfWeekBRT,
  endOfMonthBRT,
  addDaysYMD,
};
