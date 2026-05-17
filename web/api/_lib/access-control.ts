// MIRROR de web/src/lib/access-control.ts — manter em paridade. Mudou aqui? Mudou lá também.
// Regras INLINE (não importa JSON) pra evitar problemas de bundling em Vercel serverless.
// Se mudar regras, atualizar TAMBÉM em _remote/src/services/la-report-access-rules.json
// (fonte canônica usada pelo TOM via require) E em web/src/lib/access-rules.json (bundle PWA).

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

const DATA_LEVELS: Record<string, string> = {
  faturamento: 'restrito', valor_parcela: 'restrito', comissao: 'restrito', salario: 'restrito',
  ltv: 'restrito', ticket_medio: 'restrito', dados_pessoais_rh: 'restrito', avaliacao_360: 'restrito',
  inadimplencia: 'sensivel', health_score: 'sensivel', whatsapp_aluno: 'sensivel', evasao: 'sensivel',
  renovacao: 'sensivel', performance_prof: 'sensivel', leads: 'sensivel', funil: 'sensivel',
  kpis_comerciais: 'sensivel', experimentais: 'sensivel', valor_patrimonial: 'sensivel',
  aluno_cadastro: 'aberto', aluno_horario: 'aberto', aluno_presenca: 'aberto', contagem_alunos: 'aberto',
  professor_cadastro: 'aberto', whatsapp_prof: 'aberto', aderencia_emusys: 'aberto', salas: 'aberto',
  inventario: 'aberto', movimentacoes: 'aberto', loja_produtos: 'aberto', loja_vendas: 'aberto',
};

const ACCESS_RULES: Record<string, any> = {
  faturamento:       { roles: ['director'], function_roles: ['backoffice_fin'] },
  valor_parcela:     { roles: ['director'], function_roles: ['backoffice_fin'] },
  comissao:          { roles: ['director'], function_roles: ['backoffice_fin'] },
  salario:           { roles: ['director'], function_roles: ['backoffice_fin','backoffice_rh'] },
  ltv:               { roles: ['director'], function_roles: ['backoffice_fin'] },
  ticket_medio:      { roles: ['director'], function_roles: ['backoffice_fin'] },
  dados_pessoais_rh: { roles: ['director'], function_roles: ['backoffice_rh'] },
  avaliacao_360:     { roles: ['director','coordinator'] },
  inadimplencia:     { roles: ['director'], function_roles: ['backoffice_fin','farmer'], unit_filter: true, manager_unit: true },
  health_score:      { roles: ['director','coordinator'], function_roles: ['backoffice_cs','farmer'], unit_filter: true, manager_unit: true },
  whatsapp_aluno:    { roles: ['director','coordinator'], function_roles: ['marketing','farmer'], unit_filter: true, manager_unit: true, pedagogico: true },
  evasao:            { roles: ['director','coordinator'], function_roles: ['backoffice_cs','farmer'], unit_filter: true, manager_unit: true },
  renovacao:         { roles: ['director','coordinator'], function_roles: ['backoffice_cs','farmer','hunter'], unit_filter: true, manager_unit: true },
  performance_prof:  { roles: ['director','coordinator'], function_roles: ['farmer'], unit_filter: true, manager_unit: true, pedagogico: true },
  leads:             { roles: ['director'], function_roles: ['marketing','farmer','hunter'], unit_filter: true, manager_unit: true, krissya_all_comercial: true },
  funil:             { roles: ['director'], function_roles: ['marketing','farmer','hunter'], unit_filter: true, manager_unit: true, krissya_all_comercial: true },
  kpis_comerciais:   { roles: ['director'], function_roles: ['marketing','farmer'], unit_filter: true, manager_unit: true, krissya_all_comercial: true },
  experimentais:     { roles: ['director'], function_roles: ['marketing','farmer','hunter'], unit_filter: true, manager_unit: true },
  valor_patrimonial: { roles: ['director'], function_roles: ['ops_tecnicas','backoffice_fin'] },
  aluno_cadastro:    { roles: ['director','coordinator'], function_roles: ['farmer','hunter','backoffice_cs'], unit_filter: true, manager_unit: true, pedagogico_seus: true, professor_seus_unidades: true },
  aluno_horario:     { roles: ['director','coordinator'], function_roles: ['farmer','hunter','backoffice_cs'], unit_filter: true, manager_unit: true, pedagogico_seus: true, professor_seus_unidades: true },
  aluno_presenca:    { roles: ['director','coordinator'], function_roles: ['farmer','backoffice_cs'], unit_filter: true, manager_unit: true, pedagogico_seus: true, professor_seus_unidades: true },
  contagem_alunos:   { roles: ['director','coordinator','manager'], function_roles: ['farmer','hunter','backoffice_cs'] },
  professor_cadastro:{ roles: ['director','coordinator','manager'], function_roles: ['ops_tecnicas','farmer','hunter','tech'], pedagogico: true, professor: true },
  whatsapp_prof:     { all: true },
  aderencia_emusys:  { roles: ['director','coordinator'], function_roles: ['farmer'], unit_filter: true, manager_unit: true, pedagogico: true, professor_seus_unidades: true },
  salas:             { roles: ['director','coordinator','manager'], function_roles: ['ops_tecnicas','farmer','tech'], pedagogico: true, professor_seus_unidades: true },
  inventario:        { roles: ['director','coordinator'], function_roles: ['ops_tecnicas','farmer','tech'], unit_filter: true, manager_unit: true, pedagogico: true, professor_seus_unidades: true },
  movimentacoes:     { roles: ['director','coordinator'], function_roles: ['ops_tecnicas','farmer','tech'], unit_filter: true, manager_unit: true },
  loja_produtos:     { roles: ['director'], function_roles: ['ops_tecnicas','farmer','backoffice_fin'], unit_filter: true, manager_unit: true },
  loja_vendas:       { roles: ['director'], function_roles: ['ops_tecnicas','farmer','backoffice_fin'], unit_filter: true, manager_unit: true },
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
