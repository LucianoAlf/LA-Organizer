// src/services/quiet-hours.js
// Shared util: isQuietNow — verifica quiet_days, quiet_weekends e quiet_start/end_time.
// Extraído de dispatcher.js para evitar dependência circular com checkpoint-deadlines.js.
//
// Callers passam:
//   collabOrId — objeto user_preferences direto, colaborador com .user_preferences aninhado,
//                ou string UUID do collaborator_id (faz query no banco)
//   now        — { hour, minute, dow } (formato nowSaoPaulo() do dispatcher)

'use strict';

const supabase = require('../supabase/client');

/**
 * Retorna { quiet: boolean, reason: string|null }.
 * quiet=true significa: TOM não deve enviar mensagem proativa agora.
 */
async function isQuietNow(collabOrId, now) {
  let prefs = null;

  if (collabOrId && typeof collabOrId === 'object') {
    // Aceita: objeto user_preferences direto, ou colaborador com .user_preferences
    prefs = collabOrId.user_preferences || collabOrId;
  } else if (typeof collabOrId === 'string') {
    // UUID: busca as prefs do banco (inclui campos de horário)
    const { data } = await supabase
      .from('user_preferences')
      .select('quiet_weekends, quiet_days, quiet_reason, quiet_start_time, quiet_end_time')
      .eq('collaborator_id', collabOrId)
      .maybeSingle();
    prefs = data;
  }

  if (!prefs) return { quiet: false, reason: null };

  const dow = now.dow;

  // 1. Fins de semana silenciosos
  if (prefs.quiet_weekends && (dow === 0 || dow === 6)) {
    return { quiet: true, reason: `quiet_weekends${prefs.quiet_reason ? ':' + prefs.quiet_reason : ''}` };
  }

  // 2. Dias da semana silenciosos (ex: domingo = 0)
  if (Array.isArray(prefs.quiet_days) && prefs.quiet_days.includes(dow)) {
    return { quiet: true, reason: `quiet_day:${dow}${prefs.quiet_reason ? ':' + prefs.quiet_reason : ''}` };
  }

  // 3. Intervalo horário recorrente diário (quiet_start_time / quiet_end_time)
  //    Suporta ranges normais (00:00–11:00) e ranges que cruzam meia-noite (22:00–08:00).
  if (prefs.quiet_start_time && prefs.quiet_end_time) {
    const nowMins = now.hour * 60 + now.minute;
    const [sh, sm] = prefs.quiet_start_time.split(':').map(Number);
    const [eh, em] = prefs.quiet_end_time.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins   = eh * 60 + em;

    let inQuiet;
    if (startMins <= endMins) {
      // Range normal: ex. 00:00–11:00 ou 08:00–18:00
      inQuiet = nowMins >= startMins && nowMins < endMins;
    } else {
      // Range cruza meia-noite: ex. 22:00–08:00
      inQuiet = nowMins >= startMins || nowMins < endMins;
    }

    if (inQuiet) {
      const label = `${prefs.quiet_start_time.slice(0, 5)}-${prefs.quiet_end_time.slice(0, 5)}`;
      return { quiet: true, reason: `quiet_hours:${label}` };
    }
  }

  return { quiet: false, reason: null };
}

module.exports = { isQuietNow };
