import { useState, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical, MoreVertical } from 'lucide-react';
import { PROJECT_CATEGORY_LABELS, PROJECT_STATUS_LABELS } from '../lib/projectLabels';
import { dragLiftStyle } from '../lib/sortableStyle';
import { CategoryTag } from './CategoryTag';
import type { Project } from '../types';

// Sprint 22.7 — ProjectCard ganha CRUD inline e drag-and-drop, mesmo padrao
// dos checkpoints/tasks dentro de ProjetoDetalhe. Substituiu o <Link> wrapper
// por <article> + useNavigate pra suportar drag/edit sem conflito.

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
  /** Quando passado, mostra menu (...) com Editar nome. */
  onRename?: (name: string) => void;
  /** Quando passado, menu (...) inclui Excluir projeto. */
  onDelete?: () => void;
  /** Quando passado, CategoryTag vira clicavel com dropdown de categorias. */
  onUpdateCategory?: (category: Project['category']) => void;
  /** Sortable wiring vindo do useSortable. */
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}

export function ProjectCard({
  project,
  nextCheckpoint,
  onRename,
  onDelete,
  onUpdateCategory,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: Props) {
  const navigate = useNavigate();
  const pct = Math.max(0, Math.min(100, project.progress_percent ?? 0));
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(project.name);

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== project.name && onRename) onRename(v.slice(0, 200));
    setEditing(false);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setEditValue(project.name); setEditing(false); }
  }

  function handleCardClick(e: React.MouseEvent) {
    // Nao navega se: editando, dragging em curso, ou click veio do menu/handle.
    if (editing || isDragging) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-nav]')) return;
    navigate(`/projetos/${project.id}`);
  }

  return (
    <article
      ref={sortableRef}
      style={dragLiftStyle(isDragging, sortableStyle)}
      onClick={handleCardClick}
      className={[
        'surface p-md transition-colors focus-ring touch-none',
        editing ? 'cursor-default' : 'cursor-pointer hover:bg-bg-elevated',
      ].join(' ')}
      {...(sortableAttributes ?? {})}
      {...(sortableListeners ?? {})}
    >
      <div className="flex items-start gap-md justify-between">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {sortableListeners && (
            <span aria-hidden className="mt-0.5 text-fg-muted/40 cursor-grab shrink-0">
              <GripVertical size={14} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                autoFocus
                value={editValue}
                maxLength={200}
                onChange={e => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKey}
                onClick={e => e.stopPropagation()}
                data-no-nav
                className="w-full h-9 px-2 -ml-2 rounded-md bg-bg-elevated border border-border text-card-title text-fg focus-ring"
              />
            ) : (
              <div className="text-card-title truncate">{project.name}</div>
            )}
            {STATUS_NEEDS_CHIP[project.status] && !editing && (
              <span className="inline-block text-label text-fg-muted bg-bg-elevated rounded-full px-2 py-0.5 mt-1 border border-border">
                {PROJECT_STATUS_LABELS[project.status]}
              </span>
            )}
            {project.description && !editing && (
              <p className="text-body-sm text-fg-muted line-clamp-2 mt-1">{project.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-start gap-1 shrink-0" data-no-nav>
          <CategoryTag
            project={project}
            label={PROJECT_CATEGORY_LABELS[project.category]}
            onChange={onUpdateCategory}
          />
          {(onRename || onDelete) && !editing && (
            <ProjectRowMenu
              onEdit={onRename ? () => { setEditValue(project.name); setEditing(true); } : undefined}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      {!editing && (
        <>
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
        </>
      )}
    </article>
  );
}

// Mini-menu dedicado pra ProjectCard. Espelha o padrao do RowMenu de
// ProjetoDetalhe (confirm inline pra acao destrutiva).
function ProjectRowMenu({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Click outside fecha
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setTimeout(() => { setOpen(false); setConfirmDelete(false); }, 150);
    }
  }

  return (
    <div className="relative" data-no-nav onBlur={handleBlur}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); setConfirmDelete(false); }}
        aria-label="Mais ações"
        className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-body-sm text-fg hover:bg-bg-elevated"
            >
              Editar nome
            </button>
          )}
          {onDelete && !confirmDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="w-full px-3 py-2 text-left text-body-sm text-danger hover:bg-bg-elevated"
            >
              Excluir projeto
            </button>
          )}
          {onDelete && confirmDelete && (
            <div className="px-3 py-2 bg-danger/5 border-t border-border">
              <div className="text-body-sm text-fg mb-2">Excluir? Tarefas viram orfas.</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                  className="flex-1 h-7 px-2 rounded-sm text-body-sm text-fg-muted hover:text-fg border border-border focus-ring"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); setConfirmDelete(false); }}
                  className="flex-1 h-7 px-2 rounded-sm text-body-sm font-semibold bg-danger text-white focus-ring"
                >
                  Confirmar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
