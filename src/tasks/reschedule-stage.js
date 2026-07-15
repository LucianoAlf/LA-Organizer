'use strict';
// reschedule-stage.js — staging determinístico de reagendamento (i). PURO.
// Spec: docs/superpowers/specs/2026-07-15-staged-reschedule-design.md
// Plano: docs/superpowers/plans/2026-07-15-staged-reschedule.md
//
// O LLM emite TASK_UPDATE com confirm:true (nível-batch); o engine intercepta, resolve/valida
// as datas AQUI (Trap B: YMD absoluto, nunca reparsear no resume), abre um pending_intent
// reschedule_confirm com o payload já-resolvido + preview, e NÃO executa. O "Isso" retoma.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Aliases que o LLM às vezes emite (espelha engine 3617-3620): due_date→new_due_date etc.
// Não sobrescreve o campo canônico quando presente.
function normalizeRescheduleActions(actions) {
  return (Array.isArray(actions) ? actions : []).map((a) => {
    const o = { ...a };
    if (typeof o.due_date === 'string' && !o.new_due_date) o.new_due_date = o.due_date;
    if (typeof o.remind_at === 'string' && !o.new_remind_at) o.new_remind_at = o.remind_at;
    return o;
  });
}

// Particiona em resolved (data absoluta válida OU remind_at) e ambiguous (nem uma nem outra,
// OU data no passado quando opts.todayYmd é dado). §9.4/Trap B: o ambíguo NUNCA é dropado —
// volta pro preview perguntar. Comparação de YMD é lexicográfica (zero-padded, sem tz).
function partitionResolved(actions, opts = {}) {
  const todayYmd = typeof opts.todayYmd === 'string' && ISO_DATE_RE.test(opts.todayYmd) ? opts.todayYmd : null;
  const resolved = [], ambiguous = [];
  for (const a of normalizeRescheduleActions(actions)) {
    const hasDate = typeof a.new_due_date === 'string' && ISO_DATE_RE.test(a.new_due_date);
    const hasRemind = typeof a.new_remind_at === 'string' && a.new_remind_at.length >= 10;
    if (hasDate && todayYmd && a.new_due_date < todayYmd) {
      ambiguous.push({ ...a, reason: `data no passado (${a.new_due_date} < ${todayYmd})` });
    } else if (hasDate || hasRemind) {
      resolved.push(a);
    } else {
      ambiguous.push({ ...a, reason: 'sem data absoluta (new_due_date YYYY-MM-DD)' });
    }
  }
  return { resolved, ambiguous };
}

function _fmtYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${m[3]}/${m[2]}` : String(ymd || '');
}

// Preview inline ESTRUTURADO montado do payload resolvido — nunca re-narrado pelo LLM (§6).
// Quando há ambígua, pergunta a data dela e NÃO oferece "Confirma?" cego.
function buildReschedulePreview(resolved, ambiguous = [], titleById = {}) {
  const name = (id) => titleById[id] || `tarefa ${String(id).slice(0, 8)}`;
  let msg = '';
  if (resolved && resolved.length) {
    const lines = resolved.map((a) =>
      `• *${name(a.id)}* → ${a.new_due_date ? _fmtYmd(a.new_due_date) : String(a.new_remind_at).slice(0, 16)}`);
    msg = `📋 Vou reagendar:\n${lines.join('\n')}`;
  }
  if (ambiguous && ambiguous.length) {
    const amb = ambiguous.map((a) => `• *${name(a.id)}*`).join('\n');
    msg += (msg ? '\n\n' : '') + `❓ Não peguei a data de:\n${amb}\n\nQual data pra essa(s)?`;
  } else if (resolved && resolved.length) {
    msg += '\n\nConfirma? (responde "isso" / "sim")';
  }
  return msg;
}

module.exports = {
  ISO_DATE_RE, normalizeRescheduleActions, partitionResolved, buildReschedulePreview,
};
