// Mapeamento canônico de status técnicos do banco para linguagem humana.
// REGRA GLOBAL (Sprint 8): nenhuma tela do PWA exibe enum cru. Sempre passa
// pelo label aqui. Se aparecer algo como "pending_approval" na UI, é bug.
import type { ProjectStatus, ProjectCategory, ProjectLocation } from '../types';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  pending_approval: 'Aguardando aprovação',
  planning: 'Em planejamento',
  active: 'Em andamento',
  paused: 'Pausado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const PROJECT_CATEGORY_LABELS: Record<ProjectCategory, string> = {
  pedagogical: 'Pedagógico',
  commercial: 'Comercial',
  administrative: 'Administrativo',
  operational: 'Operacional',
  event: 'Evento',
  infrastructure: 'Infraestrutura',
};

export const PROJECT_LOCATION_LABELS: Record<ProjectLocation, string> = {
  campo_grande: 'Campo Grande',
  recreio: 'Recreio',
  barra: 'Barra',
  online: 'Online',
  outro: 'Outro',
};
