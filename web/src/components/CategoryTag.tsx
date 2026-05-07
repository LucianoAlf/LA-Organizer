import type { Project } from '../types';

// Sprint 22 Phase A — paleta única de categoria. Antes vivia inline em TaskRow,
// ProjectCard e Semana. Agora qualquer tela importa daqui — sem duplicação.
// Spec: docs/design-system.md §1.2.
const CATEGORY_TAG: Record<Project['category'], string> = {
  pedagogical:    'bg-[#8B5CF6]/15 text-[#C4B5FD]',
  commercial:     'bg-[#D946EF]/15 text-[#F0ABFC]',
  administrative: 'bg-[#06B6D4]/15 text-[#A5F3FC]',
  operational:    'bg-[#14B8A6]/15 text-[#99F6E4]',
  event:          'bg-[#F43F5E]/15 text-[#FECDD3]',
  infrastructure: 'bg-[#64748B]/20 text-[#CBD5E1]',
};

interface ProjectLite {
  name: string;
  category?: Project['category'] | string | null;
}

interface Props {
  project?: ProjectLite | null;
  /** Sobrescreve o nome exibido (ex: mostrar nome curto). */
  label?: string;
  className?: string;
}

export function CategoryTag({ project, label, className }: Props) {
  if (!project?.name && !label) return null;
  const cat = project?.category as Project['category'] | undefined;
  const cls = (cat && CATEGORY_TAG[cat]) ?? 'bg-bg-elevated text-fg-muted border border-border';
  return (
    <span className={['inline-block text-[11px] font-medium rounded-sm px-1.5 py-0.5', cls, className ?? ''].join(' ')}>
      {label ?? project!.name}
    </span>
  );
}
