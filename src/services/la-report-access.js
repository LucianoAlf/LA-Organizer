// _remote/src/services/la-report-access.js
// Gate de acesso ao LA Report — fonte única de regras é la-report-access-rules.json
// Usado por: TOM (engine, services, skills). PWA + serverless usam o port TS.

const rules = require('./la-report-access-rules.json');

const { DATA_LEVELS, ACCESS_RULES } = rules;

/**
 * Verifica acesso do collaborator a um tipo de dado.
 *
 * @param {Object} collab - { id, role, unit, full_name, function_role, pedagogical_role }
 * @param {string} dataType - chave de ACCESS_RULES
 * @param {Object} [opts]
 * @param {string} [opts.targetUnit] - unidade alvo (pra validar se collab tem acesso)
 * @returns {{ allowed: boolean, unitFilter: string|string[]|null, scopeFilter: string|null, reason: string }}
 */
function checkAccess(collab, dataType, opts = {}) {
  const rule = ACCESS_RULES[dataType];
  if (!rule) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Tipo de dado não reconhecido.' };

  if (!collab) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Sem collaborator.' };

  const { role, unit, full_name, function_role, pedagogical_role, has_coord_permissions } = collab;

  if (rule.all) return ok();
  if (role === 'director') return ok();
  if (rule.roles && rule.roles.includes(role)) return ok();
  // Sprint 28 — has_coord_permissions concede acesso quando a regra contempla coordinator.
  if (has_coord_permissions === true && rule.roles && rule.roles.includes('coordinator')) return ok();

  if (rule.function_roles && function_role && rule.function_roles.includes(function_role)) {
    const needsUnit = rule.unit_filter && unit && unit !== 'all';
    return { allowed: true, unitFilter: needsUnit ? unit : null, scopeFilter: null, reason: 'ok' };
  }

  if (rule.manager_unit && role === 'manager') {
    if (rule.krissya_all_comercial && full_name === 'Krissya') return ok();
    if (unit && unit !== 'all') {
      return { allowed: true, unitFilter: unit, scopeFilter: null, reason: 'ok' };
    }
    // manager sem unidade específica não tem acesso unit-scoped
  }

  if (rule.pedagogico && pedagogical_role) return ok();

  if (rule.pedagogico_seus && pedagogical_role) {
    return { allowed: true, unitFilter: null, scopeFilter: 'seus_alunos', reason: 'ok' };
  }

  if (rule.professor_seus_unidades && function_role === 'professor') {
    // STUB Fase A: nenhum professor cadastrado como collaborator.
    // Fase B+: chamar unidadesDoProfessor(collab) e retornar unitFilter array.
    return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Professor sem unidades vinculadas — fala com a coordenação.' };
  }

  if (rule.professor && function_role === 'professor') return ok();

  return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' };
}

function ok() {
  return { allowed: true, unitFilter: null, scopeFilter: null, reason: 'ok' };
}

module.exports = { checkAccess, DATA_LEVELS, ACCESS_RULES };
