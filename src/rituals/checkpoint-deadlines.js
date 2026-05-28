// src/rituals/checkpoint-deadlines.js
// Lembrete proativo de prazo de checkpoint. Disparado pelo dispatcher 1x/dia (09:00 BRT).
// Para cada checkpoint nao-done/cancelled com due_date em D-3, D-1, D0, D+1,
// manda mensagem WhatsApp pro responsavel (project_checkpoints.assigned_to) ou,
// no fallback, pro dono do projeto (projects.created_by).
//
// Idempotencia: 1 mensagem por checkpoint+marco+dia via ritual_logs
// (ritual_type='checkpoint_deadline', detail='cp:<id>:D<offset>').

const supabase = require('../supabase/client');
const whatsapp = require('../services/whatsapp');
const { isQuietNow } = require('../services/quiet-hours');

// Retorna { hour, minute, dow } em America/Sao_Paulo (mini-versão local de nowSaoPaulo).
function spNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type).value;
  return {
    hour:   parseInt(get('hour'),   10),
    minute: parseInt(get('minute'), 10),
    dow:    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday')),
  };
}

function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(ymdA, ymdB) {
  // A - B em dias (positivo se A > B, ou seja, A no futuro em relacao a B).
  const a = new Date(ymdA + 'T12:00:00Z');
  const b = new Date(ymdB + 'T12:00:00Z');
  return Math.round((a - b) / 86400000);
}

function brShort(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function buildMessage(cp, projectName, dias) {
  let header;
  if (dias < 0) {
    header = `🔴 ⚠️ Prazo vencido há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? '' : 's'}!`;
  } else if (dias === 0) {
    header = `🟡 ⏰ Prazo é *hoje*!`;
  } else {
    header = `🟢 📅 Prazo em ${dias} dia${dias === 1 ? '' : 's'} (${brShort(cp.due_date)})`;
  }
  const lines = [
    `*${projectName}*`,
    `Checkpoint: *${cp.name}*`,
    header,
  ];
  if (cp.rationale) {
    lines.push('', `💡 ${cp.rationale}`);
  }
  lines.push('', 'Como tá o andamento? Posso ajudar com algo?');
  return lines.join('\n');
}

async function alreadySent(collaboratorId, refKey, ymd) {
  const { data, error } = await supabase
    .from('ritual_logs')
    .select('id')
    .eq('collaborator_id', collaboratorId)
    .eq('ritual_type', 'checkpoint_deadline')
    .eq('reference_date', ymd)
    .eq('detail', refKey)
    .limit(1);
  if (error) {
    console.error('[checkpoint_deadline] alreadySent err:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function logSent(collaboratorId, refKey, ymd) {
  try {
    const { error } = await supabase.from('ritual_logs').insert({
      collaborator_id: collaboratorId,
      ritual_type: 'checkpoint_deadline',
      reference_date: ymd,
      status: 'sent',
      detail: refKey,
      sent_at: new Date().toISOString(),
    });
    if (error) console.error('[checkpoint_deadline] log err:', error.message);
  } catch (e) {
    console.error('[checkpoint_deadline] log throw:', e.message);
  }
}

async function getCollab(collaboratorId) {
  const { data } = await supabase
    .from('collaborators')
    .select('id, phone, full_name, is_active, user_preferences(quiet_weekends, quiet_days, quiet_reason, quiet_start_time, quiet_end_time)')
    .eq('id', collaboratorId)
    .maybeSingle();
  return data;
}

/**
 * Varre project_checkpoints com prazo em D-3, D-1, D0, D+1 e manda lembrete WhatsApp
 * pro responsavel (assigned_to) ou, no fallback, projects.created_by.
 *
 * @param {{ today?: string }} [opts] - today em YYYY-MM-DD (BRT). Default: hoje BRT.
 * @returns {Promise<{ sent: number, skipped: number, total: number, error?: string }>}
 */
async function runCheckProjectDeadlines(opts = {}) {
  // Resolve "hoje" em America/Sao_Paulo se nao vier explicito.
  let today = opts.today;
  if (!today) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date()).reduce((acc, p) => {
      acc[p.type] = p.value; return acc;
    }, {});
    today = `${parts.year}-${parts.month}-${parts.day}`;
  }

  const marcos = [addDays(today, -3), addDays(today, -1), today, addDays(today, 1)];
  console.log(`[checkpoint_deadline] varrendo marcos: ${marcos.join(', ')}`);

  const { data: cps, error } = await supabase
    .from('project_checkpoints')
    .select(`
      id, name, due_date, status, assigned_to, rationale,
      projects:project_id(id, name, created_by, status)
    `)
    .not('status', 'in', '(done,cancelled)')
    .not('due_date', 'is', null)
    .in('due_date', marcos);

  if (error) {
    console.error('[checkpoint_deadline] query err:', error.message);
    return { sent: 0, skipped: 0, total: 0, error: error.message };
  }

  let sent = 0, skipped = 0;
  for (const cp of cps || []) {
    if (!cp.projects) { skipped++; continue; }
    // Pula projetos arquivados/cancelados/concluidos.
    if (['archived', 'cancelled', 'completed'].includes(cp.projects.status)) {
      skipped++;
      continue;
    }
    const responsavelId = cp.assigned_to || cp.projects.created_by;
    if (!responsavelId) { skipped++; continue; }

    const dias = diffDays(cp.due_date, today);
    const refKey = `cp:${cp.id}:D${dias}`;

    if (await alreadySent(responsavelId, refKey, today)) {
      skipped++;
      continue;
    }

    const collab = await getCollab(responsavelId);
    if (!collab?.phone || !collab.is_active) { skipped++; continue; }

    // Respeita quiet_hours recorrente (quiet_start_time / quiet_end_time) e quiet_days/weekends.
    const q = await isQuietNow(collab, spNow());
    if (q.quiet) {
      console.log(`[checkpoint_deadline] skip cp=${cp.id.slice(0,8)} — quiet (${q.reason})`);
      skipped++;
      continue;
    }

    const msg = buildMessage(cp, cp.projects.name, dias);
    try {
      await whatsapp.sendMessage(collab.phone, msg);
      await logSent(responsavelId, refKey, today);
      sent++;
      console.log(`[checkpoint_deadline] sent cp=${cp.id.slice(0,8)} D${dias} to=${collab.full_name}`);
    } catch (e) {
      console.error(`[checkpoint_deadline] send err cp=${cp.id.slice(0,8)}:`, e.message);
    }
  }

  console.log(`[checkpoint_deadline] done. sent=${sent} skipped=${skipped} total=${(cps || []).length}`);
  return { sent, skipped, total: (cps || []).length };
}

module.exports = { runCheckProjectDeadlines };
