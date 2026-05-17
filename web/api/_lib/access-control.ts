// MIRROR de web/src/lib/access-control.ts — manter em paridade. Mudou aqui? Mudou lá também.
// Port TS do la-report-access.js — DEVE estar em paridade com o JS.
// Fonte única de regras: la-report-access-rules.json (sincronizado pra access-rules.json local).

import rules from '../../src/lib/access-rules.json';

export type CollaboratorAuth = {
  id: string;
  role: string | null;
  unit: string | null;
  full_name: string;
  function_role: string | null;
  pedagogical_role: string | null;
};

export type AccessResult = {
  allowed: boolean;
  unitFilter: string | string[] | null;
  scopeFilter: string | null;
  reason: string;
};

const { DATA_LEVELS, ACCESS_RULES } = rules as {
  DATA_LEVELS: Record<string, string>;
  ACCESS_RULES: Record<string, any>;
};

export function checkAccess(
  collab: CollaboratorAuth | null,
  dataType: string,
  _opts: { targetUnit?: string } = {}
): AccessResult {
  const rule = ACCESS_RULES[dataType];
  if (!rule) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Tipo de dado não reconhecido.' };
  if (!collab) return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Sem collaborator.' };

  const { role, unit, full_name, function_role, pedagogical_role } = collab;

  if (rule.all) return ok();
  if (role === 'director') return ok();
  if (rule.roles?.includes(role)) return ok();

  if (rule.function_roles && function_role && rule.function_roles.includes(function_role)) {
    const needsUnit = rule.unit_filter && unit && unit !== 'all';
    return { allowed: true, unitFilter: needsUnit ? unit : null, scopeFilter: null, reason: 'ok' };
  }

  if (rule.manager_unit && role === 'manager') {
    if (rule.krissya_all_comercial && full_name === 'Krissya') return ok();
    if (unit && unit !== 'all') {
      return { allowed: true, unitFilter: unit, scopeFilter: null, reason: 'ok' };
    }
    // manager sem unidade específica não tem acesso unit-scoped — cai pro deny final
  }

  if (rule.pedagogico && pedagogical_role) return ok();
  if (rule.pedagogico_seus && pedagogical_role) {
    return { allowed: true, unitFilter: null, scopeFilter: 'seus_alunos', reason: 'ok' };
  }

  if (rule.professor_seus_unidades && function_role === 'professor') {
    return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Professor sem unidades vinculadas — fala com a coordenação.' };
  }

  if (rule.professor && function_role === 'professor') return ok();

  return { allowed: false, unitFilter: null, scopeFilter: null, reason: 'Essa informação é restrita ao seu perfil. Fala com o Alf ou a coordenação.' };
}

function ok(): AccessResult {
  return { allowed: true, unitFilter: null, scopeFilter: null, reason: 'ok' };
}

export { DATA_LEVELS, ACCESS_RULES };
