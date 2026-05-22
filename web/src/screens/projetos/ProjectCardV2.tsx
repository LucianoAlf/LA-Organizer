import type { ReactNode } from 'react';
import type { Project } from '../../types';
import { CATEGORY_BADGE } from './constants';

interface ProjectCardV2Props {
  project: Project;
  onClick?: () => void;
  /** Drag handle pré-renderizado (vindo do SortableCard do KanbanBoard). */
  dragHandle?: ReactNode;
}

export function ProjectCardV2({ project, onClick, dragHandle }: ProjectCardV2Props) {
  const cat = CATEGORY_BADGE[project.category];
  const progress = Math.max(0, Math.min(100, project.progress_percent ?? 0));

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  }

  return (
    // div com role="button" em vez de <button> nativo, pra permitir o handle
    // (também elemento interativo) ser filho sem violar HTML válido.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="w-full text-left rounded-lg border border-border bg-bg-elevated hover:border-tom/40 hover:bg-bg-elevated2 transition-colors p-3 focus-ring cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-1.5 min-w-0 flex-1">
          {dragHandle}
          <h3 className="text-[13px] font-semibold text-fg leading-tight line-clamp-2 min-w-0">
            {project.name}
          </h3>
        </div>
        <span
          className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: cat.bg, color: cat.fg }}
        >
          {cat.label}
        </span>
      </div>
      {project.description && (
        <p className="text-[11px] text-fg-muted line-clamp-2 mb-2">{project.description}</p>
      )}
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">
          Progresso
        </span>
        <span className="text-[10px] font-bold text-fg tabular-nums">{progress}%</span>
      </div>
      <div className="w-full h-1 rounded-full bg-bg-app overflow-hidden mt-1">
        <div
          className="h-full rounded-full bg-tom transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
