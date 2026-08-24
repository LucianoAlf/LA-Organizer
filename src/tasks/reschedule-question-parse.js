'use strict';
// reschedule-question-parse.js — Fatia 5 (confirmação parse-on-open, reagendamento).
//
// Extrai as (título → nova data) da PROPOSTA de remarcação do TOM ("Vou reagendar: • *X* → 02/09
// … Confirma?"), pra o hook genérico de fim-de-turno (engine ~13700) abrir o intent com
// payload.reschedule ESTRUTURADO — aí o "sim" aplica determinístico (applyTaskActions) em vez de
// o LLM ter que re-emitir o marker (não reemite → NOOP silencioso; Matheus 14/07, finding
// 5eb6bb00). Gêmea de coord-question-parse (Fatia 3) e complete-question-parse (Fatia 4).
//
// FAIL-CLOSED: só produz ação quando (a) há VERBO de reagendar, (b) a linha tem "título → data
// ABSOLUTA" (DD/MM, DD/MM/AAAA ou ISO). Dia-da-semana/relativo sem DD/MM → linha ignorada.
// Remarcar pra DATA errada é pior que o drop atual. Puro (sem I/O): a resolução título→id fica no
// hook, fail-closed via resolveTaskTarget (idem Fatia 4).

// Verbo de reagendar em qualquer posição.
const RESCHED_RE = /reagend\w*|remarc\w*|empurr\w*|adia(?:r|ndo)?|novos?\s+prazos?|mud\w*\s+(?:o|os)\s+prazos?/i;
// Pergunta de confirmação (espelha GENERIC_CONFIRM_Q do pending-intents). O TOM propõe remarcação
// SEM verbo com frequência ("aqui o que eu faria: … Confirma?" — spike #3); o gate não pode
// depender do verbo. A trava REAL contra falso-positivo é o hook, que resolve título→id fail-
// closed contra tarefas EXISTENTES e só roda em intent kind='confirmation'.
const CONFIRM_RE = /\bconfirma[r]?\b|pode\s+ser\b|posso\s+seguir\b|fica\s+assim\b|tudo\s+certo\b|\btopa\b|\bfechado\b/i;
// Negação do verbo desqualifica a fala inteira ("Não vou reagendar nada agora").
const NEG_RE = /\bn[ãa]o\s+(?:vou\s+|posso\s+|consegui\s+)?(?:reagend|remarc|mud|empurr|adia)/i;
const ISO_RE = /(\d{4})-(\d{2})-(\d{2})/;
const DDMM_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

function pad(n) { return String(n).padStart(2, '0'); }

function validYmd(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// DD/MM → ISO. Com ano explícito respeita-o; sem ano, próxima ocorrência >= hoje (lexicográfico,
// YMD zero-paddado, sem tz). Sem todayYmd não resolve DD/MM sem ano (fail-closed).
function resolveDDMM(dd, mm, yy, todayYmd) {
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
  if (yy != null) { const year = yy < 100 ? 2000 + yy : yy; return `${year}-${pad(mm)}-${pad(dd)}`; }
  if (typeof todayYmd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(todayYmd)) return null;
  const ty = parseInt(todayYmd.slice(0, 4), 10);
  let cand = `${ty}-${pad(mm)}-${pad(dd)}`;
  if (cand < todayYmd) cand = `${ty + 1}-${pad(mm)}-${pad(dd)}`;
  return cand;
}

function extractDate(rhs, todayYmd) {
  const iso = ISO_RE.exec(rhs);
  if (iso) return validYmd(iso[1], parseInt(iso[2], 10), parseInt(iso[3], 10));
  const dm = DDMM_RE.exec(rhs);
  if (dm) return resolveDDMM(parseInt(dm[1], 10), parseInt(dm[2], 10), dm[3] ? parseInt(dm[3], 10) : null, todayYmd);
  return null;
}

// Título = texto em *negrito* se houver (o preview do TOM negrita o título); senão o LHS limpo
// de marcador/bullet e de verbo-conector inicial ("Vou reagendar a X" → "X"). Vazio → null.
function extractTitle(lhs) {
  const b = /\*([^*]+)\*/.exec(lhs);
  let t = b ? b[1] : lhs;
  t = t.replace(/^[\s•\-*▪·]+/, '').replace(/[\s*]+$/, '').trim();
  if (!b) {
    t = t.replace(/^(?:vou\s+)?(?:reagend\w*|remarc\w*|mud\w*\s+o?\s*prazos?\s*(?:de|da|do)?|empurr\w*|adia\w*)\s+(?:a|o|as|os|essa|esse|essas|esses|minha|minhas|meu|meus)?\s*/i, '').trim();
  }
  return t || null;
}

function parseRescheduleConfirmQuestion(replyText, opts = {}) {
  if (typeof replyText !== 'string' || !replyText.trim()) return null;
  if (NEG_RE.test(replyText)) return null;
  if (!RESCHED_RE.test(replyText) && !CONFIRM_RE.test(replyText)) return null;

  const todayYmd = opts && opts.todayYmd;
  const actions = [];
  for (const line of replyText.split(/\r?\n/)) {
    const ai = line.search(/→|->/);
    if (ai < 0) continue;
    const lhs = line.slice(0, ai);
    const rhs = line.slice(ai).replace(/^(?:→|->)/, '');
    const title = extractTitle(lhs);
    if (!title) continue;
    const date = extractDate(rhs, todayYmd);
    if (!date) continue;
    actions.push({ action: 'reschedule', title, new_due_date: date });
  }
  return actions.length ? { actions } : null;
}

module.exports = { parseRescheduleConfirmQuestion };
