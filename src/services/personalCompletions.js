// src/services/personalCompletions.js
// Paridade WhatsApp: TOM marcando item de lista pessoal RECORRENTE escreve em
// personal_checklist_item_completions (não is_done). Write via service_role
// (bypassa RLS); user_id vem SEMPRE do collab identificado, nunca do LLM.
const supabase = require('../supabase/client'); // mesmo client service_role do engine.js:15 (NÃO laReportClient — outro projeto)

function todaySP() {
  // YYYY-MM-DD em America/Sao_Paulo (mesma intenção do todaySP do PWA)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function dowPersonal(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 1; // 1=Dom..7=Sáb
}
function lastDayOfMonth(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

// Data-âncora do CICLO corrente (ESPELHO de web/src/lib/personalCompletions.ts —
// manter em paridade). Toggle e leitura usam a MESMA âncora: marcar uma lista
// mensal fora do dia-alvo grava no ciclo do mês, não na completion volátil de hoje.
function cycleAnchor(list, ymd = todaySP()) {
  switch (list.recurrence_type) {
    case 'daily': return ymd;
    case 'weekly': {
      const days = list.days_of_week || [];
      if (!days.length) return ymd;
      for (let i = 0; i < 7; i++) {
        const d = addDaysYmd(ymd, -i);
        if (days.includes(dowPersonal(d))) return d;
      }
      return ymd;
    }
    case 'monthly': {
      const target = list.day_of_month || 1;
      const [y, m, dom] = ymd.split('-').map(Number);
      const pad = (n) => String(n).padStart(2, '0');
      const anchorDay = (yy, mm) => Math.min(target, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
      const cur = anchorDay(y, m);
      if (dom >= cur) return `${y}-${pad(m)}-${pad(cur)}`;
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return `${py}-${pad(pm)}-${pad(anchorDay(py, pm))}`;
    }
    default: return ymd;
  }
}

function recurrenceAppliesToday(list, ymd = todaySP()) {
  switch (list.recurrence_type) {
    case 'daily': return true;
    case 'weekly': return (list.days_of_week || []).includes(dowPersonal(ymd));
    case 'monthly': {
      const dom = Number(ymd.split('-')[2]);
      const target = list.day_of_month || 1;
      if (dom === target) return true;
      return target > lastDayOfMonth(ymd) && dom === lastDayOfMonth(ymd);
    }
    default: return false;
  }
}

async function ensurePersonalCompletion(checklistId, collabId, ymd = todaySP()) {
  // get-or-create REAL (SELECT; INSERT só se faltar). Sem DO UPDATE = sem churn.
  const { data: existing, error: e1 } = await supabase
    .from('personal_checklist_completions')
    .select('id')
    .eq('checklist_id', checklistId)
    .eq('user_id', collabId)
    .eq('reference_date', ymd)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return existing;

  const { data: created, error: e2 } = await supabase
    .from('personal_checklist_completions')
    .insert({ checklist_id: checklistId, user_id: collabId, reference_date: ymd, channel: 'whatsapp' })
    .select('id')
    .single();
  if (e2) throw e2;
  return created;
}

async function togglePersonalCompletionItem(completionId, itemId, isChecked) {
  const { error } = await supabase
    .from('personal_checklist_item_completions')
    .upsert(
      { completion_id: completionId, item_id: itemId, is_checked: isChecked,
        checked_at: isChecked ? new Date().toISOString() : null },
      { onConflict: 'completion_id,item_id' },
    );
  if (error) throw error;
}

module.exports = { todaySP, cycleAnchor, recurrenceAppliesToday, ensurePersonalCompletion, togglePersonalCompletionItem };
