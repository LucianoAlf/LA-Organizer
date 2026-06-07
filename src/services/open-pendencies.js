// src/services/open-pendencies.js
// Achado #79 — FONTE ÚNICA da definição de "evento de trabalho passado sem fechamento".
//
// Antes, a query vivia inline SÓ na escalação diária (dispatcher.checkOverdueWorkEvents).
// O planejador semanal (system.js) era CEGO a esses eventos e dizia "semana limpa"
// enquanto a escalação cobrava o mesmo compromisso ~horas depois → TOM se contradizia.
//
// Definição única de pendência-de-EVENTO: context='work', status ≠ done/cancelled,
// end_at na janela [5 dias atrás 00h BRT, ontem 00h BRT). Consumida por:
//   - dispatcher.checkOverdueWorkEvents (escalação: TODOS os donos + cooldown 24h)
//   - prompts/system.js buildSystemPrompt (planejador: scope do PRÓPRIO dono, sem cooldown)
//
// Centralizar a cláusula de filtro garante que os dois não podem mais divergir por
// construção. O que varia entre os usos (scope por dono, cooldown, join) é intencional
// e fica nos opts — a definição de "stale" é única.
'use strict';

// Select com join de collaborators+prefs — a escalação precisa (is_active/phone/quiet).
const SELECT_FULL = 'id, title, end_at, collaborator_id, followup_sent_at, collaborators!events_collaborator_id_fkey(full_name, phone, is_active, user_preferences(*))';
// Select enxuto — o planejador só precisa do compromisso em si.
const SELECT_BASIC = 'id, title, end_at, collaborator_id';

// YMD em America/Sao_Paulo (espelha nowSaoPaulo do dispatcher.js).
function brtYmd(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * Eventos context='work' passados (end_at na janela [5 dias atrás, ontem 00h BRT))
 * e ainda abertos (status ≠ done/cancelled). Cliente supabase INJETADO → testável sem DB.
 *
 * @param {object} supabase  client do supabase (injetado)
 * @param {object} [opts]
 * @param {string}  [opts.collabId]         scope por dono (planejador). Omitir = todos (escalação).
 * @param {string}  [opts.sinceCooldownIso] cooldown: só linhas com followup_sent_at null OU < este ISO (escalação).
 * @param {Date}    [opts.now]              "agora" que define a janela BRT (default: new Date()).
 * @param {number}  [opts.limit]            default 100.
 * @param {boolean} [opts.withCollaborator] true = join collaborators+prefs. Default: true quando há cooldown (escalação), false caso contrário.
 * @returns {Promise<Array>} linhas de events (id, title, end_at, collaborator_id[, followup_sent_at, collaborators]). [] em erro/vazio.
 */
async function getStaleWorkEvents(supabase, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const ymd = brtYmd(now);
  const yesterdayEnd = new Date(ymd + 'T00:00:00-03:00').toISOString();
  const fiveDaysAgo = new Date(new Date(ymd + 'T00:00:00-03:00').getTime() - 5 * 24 * 3600_000).toISOString();

  const withCollab = (opts.withCollaborator != null)
    ? opts.withCollaborator
    : (opts.sinceCooldownIso != null);

  let q = supabase
    .from('events')
    .select(withCollab ? SELECT_FULL : SELECT_BASIC)
    .eq('context', 'work')
    .not('status', 'in', '("done","cancelled")')
    .lt('end_at', yesterdayEnd)
    .gte('end_at', fiveDaysAgo);

  if (opts.collabId) q = q.eq('collaborator_id', opts.collabId);
  if (opts.sinceCooldownIso) {
    q = q.or(`followup_sent_at.is.null,followup_sent_at.lt.${opts.sinceCooldownIso}`);
  }
  q = q.limit(opts.limit || 100);

  const { data, error } = await q;
  if (error) {
    console.error('[open-pendencies] getStaleWorkEvents err:', error.message);
    return [];
  }
  return data || [];
}

module.exports = { getStaleWorkEvents };
