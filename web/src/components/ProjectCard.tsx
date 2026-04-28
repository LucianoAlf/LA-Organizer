import { Link } from 'react-router-dom';
import { Badge } from './Badge';
import { PROJECT_CATEGORY_LABELS, PROJECT_STATUS_LABELS } from '../lib/projectLabels';
import type { Project } from '../types';

const categoryTone: Record<Project['category'], 'brand' | 'info' | 'project' | 'warning' | 'success' | 'neutral'> = {
  pedagogical: 'project',
  commercial: 'brand',
  administrative: 'info',
  operational: 'success',
  event: 'warning',
  infrastructure: 'neutral',
};

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
            <span className="inline-block text-body-xs text-fg-muted bg-bg-elevated rounded-full px-2 py-0.5 mt-1 border border-border">
              {PROJECT_STATUS_LABELS[project.status]}
            </span>
          )}
          {project.description && (
            <p className="text-body-sm text-fg-muted line-clamp-2 mt-1">{project.description}</p>
          )}
        </div>
        <Badge tone={categoryTone[project.category]}>{PROJECT_CATEGORY_LABELS[project.category]}</Badge>
      </div>

      {/* progress bar */}
      <div className="mt-md">
        <div className="flex items-center justify-between text-body-sm text-fg-muted mb-1.5 tabular-nums">
          <span>Progresso</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
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
