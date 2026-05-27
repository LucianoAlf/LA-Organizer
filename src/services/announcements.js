// src/services/announcements.js — Helpers compartilhados pra comunicados (announcements).
//
// Fonte única de verdade pra resolver `audience` JSON → lista de destinatários.
// Substitui 3 cópias divergentes do mesmo filtro que existiam antes (engine.js linha 782
// `createAnnouncementJobs`, engine.js linha 1010 inline em applyAnnouncementAction,
// e dispatcher.js linha 533 `createJobsFromAudience`) — duas delas estavam bugadas
// (não suportavam `collaborator_ids` e nem `role`, e o filtro `function_role` usava
// a coluna 'role' por engano). Bug se manifestou em 27/05/2026 com broadcast indevido
// pra 22 colaboradores em vez de 3 alvos especificados (audience traz collaborator_ids
// com strings nomes, todos os filtros silenciosamente ignorados, query retorna toda a
// equipe ativa).
//
// Garantias da nova helper:
//   1. Quando audience NÃO tem `all: true`, exige AO MENOS uma chave de filtro com
//      array não-vazio. Caso contrário retorna 0 jobs (não broadcast geral) com flag
//      `empty_audience: true` no resultado.
//   2. Suporta as 5 chaves documentadas na skill comunicados.md:
//      - `all` (boolean true → broadcast geral consciente)
//      - `role` (liderança: director/coordinator/manager → coluna `role`)
//      - `function_role` (operacional: secretary_*/pedagogical_assistant/cleaning →
//        também coluna `role`, pois o schema atual usa uma única coluna pra todos os roles)
//      - `unidade` → coluna `unit`
//      - `turno` → coluna `shift`
//      - `collaborator_ids` (UUIDs específicos → coluna `id`)
//   3. `collaborator_ids` é validado como UUID (regex). Strings nomes/aliases são
//      rejeitadas como inválidas e a chave inteira é descartada (não broadcast geral
//      por inferência).
//   4. Sempre filtra `is_active=true` e `phone is not null` (não tem como mandar
//      WhatsApp pra quem tá inativo ou sem telefone).
//
// Caller pode passar opcionalmente `{ insertJobs: false }` pra fazer dry-run e ver
// quantos destinatários seriam selecionados sem efetivamente criar jobs.

const supabase = require('../supabase/client');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Verifica se uma audience tem pelo menos uma chave de filtro válida.
// Retorna { valid: boolean, reason?: string } — usa-se pra rejeitar marker
// ANNOUNCEMENT_ACTION antes de criar o announcement, evitando ter de cancelar depois.
function validateAudience(audience) {
  if (!audience || typeof audience !== 'object') {
    return { valid: false, reason: 'audience_missing_or_not_object' };
  }
  if (audience.all === true) return { valid: true };

  const keys = ['role', 'function_role', 'unidade', 'turno', 'collaborator_ids'];
  for (const k of keys) {
    if (Array.isArray(audience[k]) && audience[k].length > 0) {
      // Se for collaborator_ids, validar que tem pelo menos 1 UUID válido.
      if (k === 'collaborator_ids') {
        const valid = audience[k].filter(v => typeof v === 'string' && UUID_RE.test(v));
        if (valid.length === 0) {
          return { valid: false, reason: 'collaborator_ids_no_valid_uuids' };
        }
      }
      return { valid: true };
    }
  }
  return { valid: false, reason: 'no_filter_keys_or_all_empty' };
}

// Resolve audience → lista de { id, phone } e opcionalmente cria announcement_jobs.
// Retorna { count, recipients?, error?, empty_audience? }.
async function createJobsFromAudience(announcementId, audience, opts = {}) {
  const { insertJobs = true } = opts;

  const validation = validateAudience(audience);
  if (!validation.valid) {
    console.warn(`[announcements.createJobsFromAudience] audience inválida (${validation.reason}) — recusando broadcast geral`);
    return { count: 0, empty_audience: true, reason: validation.reason };
  }

  let q = supabase.from('collaborators').select('id, phone').eq('is_active', true).not('phone', 'is', null);

  const aud = audience;
  if (aud.all !== true) {
    if (Array.isArray(aud.role) && aud.role.length) q = q.in('role', aud.role);
    if (Array.isArray(aud.function_role) && aud.function_role.length) q = q.in('role', aud.function_role);
    if (Array.isArray(aud.unidade) && aud.unidade.length) q = q.in('unit', aud.unidade);
    if (Array.isArray(aud.turno) && aud.turno.length) q = q.in('shift', aud.turno);
    if (Array.isArray(aud.collaborator_ids) && aud.collaborator_ids.length) {
      // Sanitização: descarta entradas não-UUID. Validação acima já garantiu que
      // sobra pelo menos uma.
      const validIds = aud.collaborator_ids.filter(v => typeof v === 'string' && UUID_RE.test(v));
      q = q.in('id', validIds);
    }
  }

  const { data: recipients, error } = await q;
  if (error) {
    console.error('[announcements.createJobsFromAudience] erro buscando recipients:', error.message);
    return { count: 0, error: error.message };
  }
  if (!recipients || recipients.length === 0) return { count: 0, recipients: [] };

  if (!insertJobs) {
    return { count: recipients.length, recipients };
  }

  const jobs = recipients.map(r => ({
    announcement_id: announcementId,
    recipient_id: r.id,
    phone: r.phone,
    status: 'pending',
    retry_count: 0,
  }));
  const { error: jobErr } = await supabase.from('announcement_jobs').insert(jobs);
  if (jobErr) {
    console.error('[announcements.createJobsFromAudience] erro INSERT jobs:', jobErr.message);
    return { count: 0, error: jobErr.message };
  }
  return { count: jobs.length, recipients };
}

module.exports = {
  validateAudience,
  createJobsFromAudience,
  UUID_RE,
};
