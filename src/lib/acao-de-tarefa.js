'use strict';
// acao-de-tarefa.js — conserta ANTES da validação dois erros de FORMATO do modelo. PURO.
//
// O CASO (achado da44ab45, Clayton 25/09 13:01–13:06). Ele pediu uma tarefa diária NOVA pra
// Vitoria e confirmou com "Ok". O modelo emitiu 4× <<TASK_UPDATE>> {"action":"delegate",
// "title":…, "to_name":"Vitoria", "recurrence":"weekdays"} — SEM id, porque a tarefa não
// existia. `delegate` exige id (é pra passar tarefa que JÁ existe), o validador recusou as 4, e
// o TOM ficou pedindo pro Clayton mandar de novo. Mesmo caso em 26/08 ("Mandar mensagem pro
// cara da Solez", to_name Luciano). O jeito certo de criar tarefa PRA outra pessoa já existe:
// action "create" + to_name.
//
// Por que o agente de governança não converteu: `create` ignora "recurrence":"weekdays" (ele lê
// `recurrence_rule`, formato RRULE) — a conversão criaria tarefa ÚNICA com o texto prometendo
// "segunda a sexta". Por isso a conversão só acontece junto com a TRADUÇÃO do atalho de
// recorrência; atalho que não sei traduzir => não converte (a recusa honesta continua).
//
// Os dois consertos:
//   1. delegate SEM id + title + destinatário  -> create + to_name/to_phone;
//   2. `recurrence` em atalho (weekdays/daily/weekly/monthly e os mesmos em português) sem
//      `recurrence_rule` -> recurrence_rule RRULE. Vale pra create também (mesmo erro de campo).

const ATALHOS = [
  [/^(weekdays?|dias?\s+[úu]teis|segunda\s+a\s+sexta|seg(unda)?\s*[-a]\s*sex(ta)?)$/i, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  [/^(daily|di[áa]ri[oa]|todo\s+dia|todos\s+os\s+dias)$/i, 'FREQ=DAILY'],
  [/^(weekly|semanal|toda\s+semana)$/i, 'FREQ=WEEKLY'],
  [/^(monthly|mensal|todo\s+m[êe]s)$/i, 'FREQ=MONTHLY'],
];
function rruleDoAtalho(atalho) {
  const s = String(atalho == null ? '' : atalho).trim();
  if (!s) return null;
  if (/^(RRULE:)?FREQ=/i.test(s)) return s.replace(/^RRULE:/i, '');
  for (const [re, rule] of ATALHOS) if (re.test(s)) return rule;
  return undefined; // atalho que não sei ler
}

const SHORT_ID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;
const _tem = (v) => typeof v === 'string' && v.trim().length > 0;

function normalizarAcaoDeTarefa(a) {
  if (!a || typeof a !== 'object') return a;
  let out = a;
  const temRecorrencia = out.recurrence !== undefined && out.recurrence !== null && out.recurrence !== '';
  const rule = temRecorrencia && !_tem(out.recurrence_rule) ? rruleDoAtalho(out.recurrence) : null;

  // 1. delegate de tarefa que não existe -> create pra outra pessoa
  if (out.action === 'delegate' && !(typeof out.id === 'string' && SHORT_ID_RE.test(out.id))
      && _tem(out.title) && (_tem(out.to_name) || _tem(out.to_phone))) {
    if (rule === undefined) return a; // recorrência que não sei traduzir: não prometo o que não crio
    const { id, recurrence, ...resto } = out;
    out = { ...resto, action: 'create', ...(rule ? { recurrence_rule: rule } : {}), _convertido: 'delegate_sem_id' };
    return out;
  }
  // 2. create com atalho de recorrência no campo errado
  if (out.action === 'create' && rule) {
    const { recurrence, ...resto } = out;
    out = { ...resto, recurrence_rule: rule };
  }
  return out;
}

module.exports = { normalizarAcaoDeTarefa, rruleDoAtalho };
