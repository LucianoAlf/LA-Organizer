import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Calendar, Users, Tag, Activity, Pencil } from 'lucide-react';
import { DetailDrawer } from '../../design/primitives/DetailDrawer';
import { ProjectEditDrawer } from '../../components/ProjectEditDrawer';
import type { Project } from '../../types';
import type { ProjectFull } from '../../types/projectDetail';
import { CATEGORY_BADGE, KANBAN_COLUMNS } from './constants';

interface ProjectDetailDrawerProps {
  project: Project | null;
  onClose: () => void;
  /**
   * Quando fornecido, exibe um botao "Editar" no footer que abre o
   * ProjectEditDrawer. O callback recebe o patch a aplicar no projeto.
   */
  onUpdate?: (patch: Partial<ProjectFull>) => void | Promise<void>;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function ProjectDetailDrawer({ project, onClose, onUpdate }: ProjectDetailDrawerProps) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  if (!project) {
    return <DetailDrawer open={false} onClose={onClose} title="">{null}</DetailDrawer>;
  }

  async function handleSave(patch: Partial<ProjectFull>) {
    if (!onUpdate) return;
    await onUpdate(patch);
    setEditOpen(false);
  }

  const cat = CATEGORY_BADGE[project.category];
  const statusLabel = KANBAN_COLUMNS.find(c => c.id === project.status)?.title
    ?? project.status;
  const progress = Math.max(0, Math.min(100, project.progress_percent ?? 0));

  return (
    <>
    <DetailDrawer
      open={!!project}
      onClose={onClose}
      title={project.name}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block px-2 py-0.5 rounded text-[10px] font-medium"
            style={{ backgroundColor: cat.bg, color: cat.fg }}
          >
            {cat.label}
          </span>
          <span>·</span>
          <span>{statusLabel}</span>
        </span>
      }
      footer={
        onUpdate ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="flex-1 h-9 flex items-center justify-center gap-2 rounded-md bg-bg-elevated border border-border text-fg text-[13px] font-semibold hover:bg-bg-elevated2 transition-colors focus-ring"
            >
              <Pencil size={14} />
              Editar
            </button>
            <button
              type="button"
              onClick={() => { onClose(); navigate(`/projetos/${project.id}`); }}
              className="flex-1 h-9 flex items-center justify-center gap-2 rounded-md bg-tom text-black text-[13px] font-semibold hover:opacity-90 transition-opacity focus-ring"
            >
              <ExternalLink size={14} />
              Abrir
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { onClose(); navigate(`/projetos/${project.id}`); }}
            className="w-full h-9 flex items-center justify-center gap-2 rounded-md bg-tom text-black text-[13px] font-semibold hover:opacity-90 transition-opacity focus-ring"
          >
            <ExternalLink size={14} />
            Abrir projeto
          </button>
        )
      }
    >
      <div className="space-y-4">
        {project.description && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">
              Descrição
            </div>
            <p className="text-[13px] text-fg whitespace-pre-wrap">{project.description}</p>
          </section>
        )}

        <section>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1.5 flex items-center gap-1.5">
            <Activity size={11} /> Progresso
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-bg-elevated overflow-hidden">
              <div className="h-full bg-tom rounded-full" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[13px] font-bold text-fg tabular-nums">{progress}%</span>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Calendar size={11} /> Início
            </div>
            <div className="text-[13px] text-fg">{formatDate(project.start_date)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Calendar size={11} /> Fim
            </div>
            <div className="text-[13px] text-fg">{formatDate(project.end_date)}</div>
          </div>
        </section>

        {project.justification && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">
              Justificativa
            </div>
            <p className="text-[13px] text-fg whitespace-pre-wrap">{project.justification}</p>
          </section>
        )}

        {project.location && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Tag size={11} /> Local
            </div>
            <div className="text-[13px] text-fg">{project.location}</div>
          </section>
        )}

        {project.estimated_hours_week !== null && (
          <section>
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1 flex items-center gap-1.5">
              <Users size={11} /> Esforço estimado
            </div>
            <div className="text-[13px] text-fg">{project.estimated_hours_week}h/semana</div>
          </section>
        )}
      </div>
    </DetailDrawer>
    {onUpdate && (
      <ProjectEditDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={project as unknown as ProjectFull}
        onSave={handleSave}
      />
    )}
    </>
  );
}
