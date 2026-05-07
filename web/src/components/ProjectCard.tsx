import { Link } from 'react-router-dom';
import { PROJECT_CATEGORY_LABELS, PROJECT_STATUS_LABELS } from '../lib/projectLabels';
import { CategoryTag } from './CategoryTag';
import type { Project } from '../types';

// Sprint 22 Phase A — palette migrada pra <CategoryTag /> (docs/design-system.md §1.2).
// Aqui o chip mostra o LABEL DA CATEGORIA (não o nome do projeto, diferente de TaskRow).

// Statuses que não são "execução normal" merecem chip explícito.
// 'active' é o default visual (sem chip = em andamento).
const STATUS_NEEDS_CHIP: Record<Project['status'], boolean> = {
  pending_approval: true,
  planning: true,
  paused: true,
  cancelled: true,
  completed: true,
  active: false,
};

interface Props {
  project: Project;
  nextCheckpoint?: { name: string; due_date: string | null } | null;
}

export function ProjectCard({ project, nextCheckpoint }: Props) {
  const pct = Math.max(0, Math.min(100, project.progress_percent ?? 0));
  return (
    <Link
      to={`/projetos/${project.id}`}
      className="block surface p-md hover:bg-bg-elevated transition-colors focus-ring"
    >
      <div className="flex items-start gap-md justify-between">
        <div className="min-w-0">
          <div className="text-card-title truncate">{project.name}</div>
          {STATUS_NEEDS_CHIP[project.status] && (
            <span className="inline-block text-label text-fg-muted bg-bg-elevated rounded-full px-2 py-0.5 mt-1 border border-border">
              {PROJECT_STATUS_LABELS[project.status]}
            </span>
          )}
          {project.description && (
            <p className="text-body-sm text-fg-muted line-clamp-2 mt-1">{project.description}</p>
          )}
        </div>
        <CategoryTag project={project} label={PROJECT_CATEGORY_LABELS[project.category]} className="shrink-0" />
      </div>

      {/* progress bar */}
      <div className="mt-md">
        <div className="flex items-center justify-between text-body-sm text-fg-muted mb-1.5 tabular-nums">
          <span>Progresso</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-tom transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {nextCheckpoint && (
        <div className="mt-md text-body-sm text-fg-muted">
          <span className="text-fg-secondary">Próximo:</span> {nextCheckpoint.name}
          {nextCheckpoint.due_date && (
            <span className="tabular-nums"> · {nextCheckpoint.due_date.slice(8, 10)}/{nextCheckpoint.due_date.slice(5, 7)}</span>
          )}
        </div>
      )}
    </Link>
  );
}
