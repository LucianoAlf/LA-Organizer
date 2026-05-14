import type { Role } from '../types';

/** Display names em português para os níveis de permissão internos. */
export const ROLE_LABELS: Record<Role, string> = {
  collaborator: 'Colaborador',
  leader:       'Líder',
  coordinator:  'Coordenador',
  manager:      'Gerente',
  director:     'Diretor',
};

/** Hierarquia numérica — admins só criam roles até o próprio nível. */
export const ROLE_RANK: Record<Role, number> = {
  collaborator: 0,
  leader:       1,
  coordinator:  2,
  manager:      3,
  director:     4,
};

/** Cor do avatar e chip por nível. */
export const ROLE_COLOR: Record<Role, string> = {
  collaborator: '#6b7280',  // gray
  leader:       '#f59e0b',  // amber
  coordinator:  '#7c3aed',  // purple
  manager:      '#0ea5e9',  // sky blue
  director:     '#E91451',  // tom/brand red
};

/** Ordem canônica dos níveis (do menor para o maior). */
export const ROLES: Role[] = [
  'collaborator',
  'leader',
  'coordinator',
  'manager',
  'director',
];

/**
 * Cargos predefinidos por nível de permissão.
 * Quando o admin muda o role, o select de function_title filtra por aqui.
 */
export const FUNCTION_TITLES: Record<Role, string[]> = {
  collaborator: ['Farmer', 'Hunter', 'Professor', 'Assistente Pedagógico', 'Financeiro', 'RH'],
  leader:       ['Líder de Equipe'],
  coordinator:  ['Coordenador'],
  manager:      ['Gerente'],
  director:     ['Diretor'],
};

/** Lista flat de todos os cargos (uso em filtros gerais). */
export const ALL_FUNCTION_TITLES: string[] = Object.values(FUNCTION_TITLES).flat();
