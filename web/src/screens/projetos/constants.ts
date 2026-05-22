import type { Project, ProjectStatus, ProjectCategory } from '../../types';

/** Ordem das colunas no Kanban e seus labels PT-BR. */
export const KANBAN_COLUMNS: Array<{ id: ProjectStatus; title: string; accentColor: string }> = [
  { id: 'pending_approval', title: 'Aguardando aprovação', accentColor: '#F59E0B' },
  { id: 'planning',         title: 'Em planejamento',      accentColor: '#60a5fa' },
  { id: 'active',           title: 'Em andamento',         accentColor: '#A3BE50' },
  { id: 'paused',           title: 'Pausado',              accentColor: '#9E9E9E' },
  { id: 'completed',        title: 'Concluído',            accentColor: '#22C55E' },
];

/** Categorias com cor (hex puro pra usar em badge inline). Mantém paridade com CategoryTag.tsx.
 *  `base` é o tom sólido vivo (pra barras de Timeline, accents fortes).
 *  `bg` + `fg` formam o badge translucido com texto. */
export const CATEGORY_BADGE: Record<ProjectCategory, { label: string; base: string; bg: string; fg: string }> = {
  pedagogical:    { label: 'Pedagógico',     base: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.15)',  fg: '#C4B5FD' },
  commercial:     { label: 'Comercial',      base: '#D946EF', bg: 'rgba(217, 70, 239, 0.15)',  fg: '#F0ABFC' },
  administrative: { label: 'Administrativo', base: '#06B6D4', bg: 'rgba(6, 182, 212, 0.15)',   fg: '#A5F3FC' },
  operational:    { label: 'Operacional',    base: '#14B8A6', bg: 'rgba(20, 184, 166, 0.15)',  fg: '#99F6E4' },
  event:          { label: 'Evento',         base: '#F43F5E', bg: 'rgba(244, 63, 94, 0.15)',   fg: '#FECDD3' },
  infrastructure: { label: 'Infraestrutura', base: '#64748B', bg: 'rgba(100, 116, 139, 0.20)', fg: '#CBD5E1' },
};

/** Agrupa projetos por status. Ignora `completed` e `cancelled` (não aparecem no kanban). */
export function groupByStatus(projects: Project[]): Record<ProjectStatus, Project[]> {
  const groups: Record<ProjectStatus, Project[]> = {
    pending_approval: [],
    planning: [],
    active: [],
    paused: [],
    completed: [],
    cancelled: [],
  };
  for (const p of projects) groups[p.status].push(p);
  return groups;
}
