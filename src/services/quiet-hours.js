// src/services/quiet-hours.js
// Shared util: isQuietNow — verifica silêncio por CONTEXTO (work|personal).
// Extraído de dispatcher.js para evitar dependência circular com checkpoint-deadlines.js.
//
// Callers passam:
//   collabOrId — objeto user_preferences direto, colaborador com .user_preferences aninhado,
//                ou string UUID do collaborator_id (faz query no banco)
//   now        — { hour, minute, dow } (formato nowSaoPaulo() do dispatcher)
//   context    — 'work' | 'personal' (default 'work'). Seleciona qual janela aplicar.
//
// Modelo: colunas quiet_*_work / quiet_*_personal (Sprint ContextPrefs). Fallback pras
// colunas globais antigas (quiet_start_time/quiet_end_time/quiet_days/quiet_weekends)
// quando a versão por contexto for NULL — garante back-compat durante a transição.

'use strict';

// require lazy (só quando recebe UUID) — permite smoke local com prefs inline
// sem depender do módulo supabase/client (que só existe no runtime do VPS).
function getSupabase() {
  return require('../supabase/client');
}

// FONTE ÚNICA das colunas que isQuietNow precisa. Qualquer caller que pré-busca
// user_preferences e passa o OBJETO deve trazer estas colunas (ou usar `(*)`),
// senão a janela horária fica invisível. Bug Quintela 2026-05-30: 3 jobs de
// alerta buscavam um subset sem as colunas de horário → silêncio desligado.
const QUIET_PREF_COLUMNS = [
  'quiet_weekends', 'quiet_days', 'quiet_reason',
  'quiet_start_time', 'quiet_end_time',
  'quiet_start_time_work', 'quiet_end_time_work', 'quiet_days_work', 'quiet_weekends_work',
  'quiet_start_time_personal', 'quiet_end_time_personal', 'quiet_days_personal', 'quiet_weekends_personal',
];

// Detecta o "footgun": um objeto que parece de preferências (tem marcador de
// quiet) mas NÃO traz NENHUMA coluna de horário (nem global nem contexto).
// Nesse estado, windowFor não enxerga a janela e o silêncio é silenciosamente
// desligado. Usado pra ALERTAR (não falha), tornando o SELECT parcial visível.
function isPartialQuietPrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return false;
  const hasQuietMarker = ('quiet_weekends' in prefs) || ('quiet_days' in prefs) || ('quiet_reason' in prefs);
  if (!hasQuietMarker) return false;
  const hasAnyHourCol = ('quiet_start_time' in prefs)
    || ('quiet_start_time_work' in prefs)
    || ('quiet_start_time_personal' in prefs);
  return !hasAnyHourCol;
}

// True se o objeto traz ALGUMA coluna de contexto (_work/_personal). Quando traz,
// windowFor a usa como autoritativa (null = sem silêncio). Quando NÃO traz, o
// windowFor cai pro legado global — e aí janelas configuradas só por contexto somem.
function hasContextCols(prefs) {
  if (!prefs || typeof prefs !== 'object') return false;
  return ('quiet_start_time_work' in prefs) || ('quiet_end_time_work' in prefs)
      || ('quiet_days_work' in prefs) || ('quiet_weekends_work' in prefs)
      || ('quiet_start_time_personal' in prefs) || ('quiet_end_time_personal' in prefs)
      || ('quiet_days_personal' in prefs) || ('quiet_weekends_personal' in prefs);
}

// O footgun de verdade (Juliana 03/06): objeto TEM cara de prefs (algum marcador de
// quiet) MAS não traz as colunas de contexto. Nesse estado a janela por contexto
// (ex.: 00:00–11:00 só em _work) fica invisível e o silêncio é desligado em silêncio.
// Quando isto é true E o objeto carrega o collaborator_id, isQuietNow re-busca o
// conjunto canônico (QUIET_PREF_COLUMNS) e cura o vazamento — vale pra TODOS os
// callers que passam objeto, sem ter que caçar cada SELECT incompleto.
function needsContextRefetch(prefs) {
  if (!prefs || typeof prefs !== 'object') return false;
  const hasQuietMarker = ('quiet_weekends' in prefs) || ('quiet_days' in prefs)
    || ('quiet_reason' in prefs) || ('quiet_start_time' in prefs);
  if (!hasQuietMarker) return false;
  return !hasContextCols(prefs);
}

// Resolve a janela de silêncio de um contexto.
// Se o caller buscou as colunas de contexto (presentes no objeto, mesmo que null),
// elas são AUTORITATIVAS — null = sem silêncio (evita ler global antiga stale após
// o usuário limpar um contexto na UI). Só cai pras colunas globais antigas quando o
// caller é legado e nem selecionou as colunas de contexto.
function windowFor(prefs, context) {
  const suffix = context === 'personal' ? '_personal' : '_work';
  const hasCtx = (`quiet_start_time${suffix}` in prefs) ||
                 (`quiet_end_time${suffix}` in prefs) ||
                 (`quiet_days${suffix}` in prefs) ||
                 (`quiet_weekends${suffix}` in prefs);
  if (hasCtx) {
    return {
      start: prefs[`quiet_start_time${suffix}`] ?? null,
      end:   prefs[`quiet_end_time${suffix}`] ?? null,
      days:  Array.isArray(prefs[`quiet_days${suffix}`]) ? prefs[`quiet_days${suffix}`] : [],
      weekends: prefs[`quiet_weekends${suffix}`] === true,
    };
  }
  // Legado: caller não selecionou colunas de contexto → usa globais antigas.
  return {
    start: prefs.quiet_start_time ?? null,
    end:   prefs.quiet_end_time ?? null,
    days:  Array.isArray(prefs.quiet_days) ? prefs.quiet_days : [],
    weekends: !!prefs.quiet_weekends,
  };
}

/**
 * Retorna { quiet: boolean, reason: string|null }.
 * quiet=true significa: TOM não deve enviar mensagem proativa agora pra esse contexto.
 */
async function isQuietNow(collabOrId, now, context = 'work') {
  let prefs = null;

  if (collabOrId && typeof collabOrId === 'object') {
    // Aceita: objeto user_preferences direto, ou colaborador com .user_preferences
    prefs = collabOrId.user_preferences || collabOrId;
    // Sprint 31.11 — AUTO-HEAL do footgun Quintela. Se o caller passou um objeto
    // com cara de prefs MAS sem as colunas de contexto (_work/_personal), a janela
    // horária por contexto fica invisível (windowFor cai no legado, que costuma ser
    // null → silêncio desligado). Caso Juliana 03/06: janela 00:00–11:00 só em _work;
    // briefing (dispatcher.js:2865) e checkpoint (checkpoint-deadlines.js:170)
    // passavam objeto parcial → cobravam 7-9h. Re-busca o conjunto canônico pelo
    // collaborator_id que o objeto carrega → conserta TODOS os callers de objeto.
    if (needsContextRefetch(prefs)) {
      const cid = prefs.collaborator_id || collabOrId.collaborator_id || collabOrId.id || null;
      if (cid) {
        try {
          const { data } = await getSupabase()
            .from('user_preferences')
            .select(QUIET_PREF_COLUMNS.join(', '))
            .eq('collaborator_id', cid)
            .maybeSingle();
          if (data) prefs = data;
        } catch (e) {
          console.warn('[quiet-hours] auto-heal refetch falhou (mantém objeto parcial):', e.message);
        }
      }
    }
  } else if (typeof collabOrId === 'string') {
    // UUID: busca as prefs do banco (inclui campos de horário por contexto + globais antigos)
    const { data } = await getSupabase()
      .from('user_preferences')
      .select(QUIET_PREF_COLUMNS.join(', '))
      .eq('collaborator_id', collabOrId)
      .maybeSingle();
    prefs = data;
  }

  if (!prefs) return { quiet: false, reason: null };

  // Trava defensiva: SELECT parcial nunca mais desliga o silêncio EM SILÊNCIO.
  if (isPartialQuietPrefs(prefs)) {
    console.warn('[quiet-hours] prefs sem colunas de horário (SELECT parcial?) — janela horária IGNORADA. Caller deve usar user_preferences(*)/QUIET_PREF_COLUMNS ou passar o UUID.');
  }

  const dow = now.dow;
  const w = windowFor(prefs, context);
  const tag = context === 'personal' ? 'personal' : 'work';

  // 1. Fins de semana silenciosos
  if (w.weekends && (dow === 0 || dow === 6)) {
    return { quiet: true, reason: `quiet_weekends_${tag}${prefs.quiet_reason ? ':' + prefs.quiet_reason : ''}` };
  }

  // 2. Dias da semana silenciosos (ex: domingo = 0)
  if (Array.isArray(w.days) && w.days.includes(dow)) {
    return { quiet: true, reason: `quiet_day_${tag}:${dow}${prefs.quiet_reason ? ':' + prefs.quiet_reason : ''}` };
  }

  // 3. Intervalo horário recorrente diário.
  //    Suporta ranges normais (00:00–11:00) e ranges que cruzam meia-noite (22:00–08:00).
  if (w.start && w.end) {
    const nowMins = now.hour * 60 + now.minute;
    const [sh, sm] = String(w.start).split(':').map(Number);
    const [eh, em] = String(w.end).split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins   = eh * 60 + em;

    let inQuiet;
    if (startMins <= endMins) {
      inQuiet = nowMins >= startMins && nowMins < endMins;
    } else {
      inQuiet = nowMins >= startMins || nowMins < endMins;
    }

    if (inQuiet) {
      const label = `${String(w.start).slice(0, 5)}-${String(w.end).slice(0, 5)}`;
      return { quiet: true, reason: `quiet_hours_${tag}:${label}` };
    }
  }

  return { quiet: false, reason: null };
}

module.exports = { isQuietNow, isPartialQuietPrefs, needsContextRefetch, hasContextCols, QUIET_PREF_COLUMNS };
