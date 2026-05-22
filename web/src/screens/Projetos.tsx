import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Rocket, Check, X as XIcon } from 'lucide-react';
import { PageShell } from '../design/primitives/PageShell';
import { Toolbar } from '../design/primitives/Toolbar';
import { ViewSwitcher } from '../design/primitives/ViewSwitcher';
import { FilterPill } from '../design/primitives/FilterPill';
import { EmptyStateDesktop } from '../design/primitives/EmptyStateDesktop';
import { SkeletonList } from '../design/primitives/LoadingSkeleton';
import { KanbanBoard } from '../design/views/KanbanBoard';
import { DenseTable } from '../design/views/DenseTable';
import type { DenseTableColumn } from '../design/views/DenseTable';
import { ProjectCardV2 } from './projetos/ProjectCardV2';
import { ProjectDetailDrawer } from './projetos/ProjectDetailDrawer';
import { KANBAN_COLUMNS, CATEGORY_BADGE, groupByStatus } from './projetos/constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/Toast';
import type { Project, ProjectStatus } from '../types';

type ViewMode = 'kanban' | 'list';

const ALIVE_STATUSES: ProjectStatus[] = ['active', 'planning', 'pending_approval', 'paused'];

const SELECT = `
  id, name, description, category, status, progress_percent,
  start_date, end_date, created_by, justification, methodology,
  location, estimated_hours_week, requires_approval, approved_by,
  approved_at, rejection_reason
`;

async function fetchProjects(collabId: string | undefined, isCoordOrDir: boolean): Promise<Project[]> {
  if (!collabId) return [];
  let query = supabase.from('projects').select(SELECT).in('status', ALIVE_STATUSES);
  if (!isCoordOrDir) {
    // Não-coord/director: ver só projetos onde é membro ou criador.
    const { data: memberRows } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('collaborator_id', collabId);
    const memberIds = (memberRows ?? []).map(r => r.project_id);
    const ids = Array.from(new Set([...memberIds]));
    if (ids.length === 0) {
      query = query.eq('created_by', collabId);
    } else {
      query = query.or(`created_by.eq.${collabId},id.in.(${ids.join(',')})`);
    }
  }
  const { data, error } = await query.order('sort_position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Project[];
}

async function fetchPendingApprovals(collabId: string | undefined): Promise<Project[]> {
  if (!collabId) return [];
  const { data, error } = await supabase
    .from('projects')
    .select(SELECT)
    .eq('status', 'pending_approval')
    .eq('requires_approval', true);
  if (error) throw error;
  return (data ?? []) as Project[];
}

export function Projetos() {
  const { collaborator, role } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isCoordOrDir = role === 'coordinator' || role === 'director';
  const [view, setView] = useState<ViewMode>('kanban');
  const [selected, setSelected] = useState<Project | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', collaborator?.id, isCoordOrDir],
    queryFn: () => fetchProjects(collaborator?.id, isCoordOrDir),
    enabled: !!collaborator?.id,
  });

  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['projects-pending-approval'],
    queryFn: () => fetchPendingApprovals(collaborator?.id),
    enabled: !!collaborator?.id && isCoordOrDir,
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('projects')
        .update({ status: 'planning', approved_by: collaborator?.id, approved_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['projects-pending-approval'] });
      showToast({ kind: 'success', title: 'Projeto aprovado!' });
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Erro', msg: err.message }),
  });

  const rejectMut = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt('Motivo da rejeição (opcional):') ?? '';
      const { error } = await supabase
        .from('projects')
        .update({ status: 'cancelled', rejection_reason: reason })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['projects-pending-approval'] });
      showToast({ kind: 'success', title: 'Projeto rejeitado' });
    },
    onError: (err: Error) => showToast({ kind: 'error', title: 'Erro', msg: err.message }),
  });

  const grouped = useMemo(() => groupByStatus(projects), [projects]);
  const totalAlive = projects.length;

  const columns = KANBAN_COLUMNS.map(col => ({
    id: col.id,
    title: col.title,
    accentColor: col.accentColor,
    items: grouped[col.id] ?? [],
  }));

  const tableColumns: DenseTableColumn<Project>[] = [
    { key: 'name', label: 'Nome', render: p => <span className="font-medium">{p.name}</span> },
    {
      key: 'category',
      label: 'Categoria',
      width: 140,
      render: p => {
        const c = CATEGORY_BADGE[p.category];
        return (
          <span
            className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{ backgroundColor: c.bg, color: c.fg }}
          >
            {c.label}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: 160,
      render: p => KANBAN_COLUMNS.find(c => c.id === p.status)?.title ?? p.status,
    },
    {
      key: 'progress',
      label: 'Progresso',
      width: 120,
      align: 'right',
      render: p => <span className="tabular-nums">{Math.round(p.progress_percent ?? 0)}%</span>,
    },
  ];

  return (
    <>
      <PageShell
        title="Projetos"
        subtitle={isLoading ? 'Carregando…' : `${totalAlive} ativos`}
        toolbar={
          <Toolbar
            left={
              <FilterPill label="Status" value="Ativos" active />
            }
            right={
              <>
                <ViewSwitcher
                  options={[
                    { id: 'kanban', label: 'Kanban', Icon: LayoutGrid },
                    { id: 'list',   label: 'Lista',  Icon: List },
                  ]}
                  value={view}
                  onChange={setView}
                />
                <button
                  type="button"
                  onClick={() => navigate('/projetos/novo')}
                  className="h-8 px-3 rounded-md bg-tom text-white text-[12px] font-semibold hover:opacity-90 focus-ring"
                >
                  + Novo
                </button>
              </>
            }
          />
        }
      >
        {/* Banner de aprovações pendentes — visível só para coord/director quando há aprovações */}
        {isCoordOrDir && pendingApprovals.length > 0 && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <div className="text-[12px] font-semibold text-warning mb-2">
              {pendingApprovals.length} projeto{pendingApprovals.length > 1 ? 's' : ''} aguardando aprovação
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingApprovals.map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 px-2 py-1 rounded-md bg-bg-surface border border-border text-[12px]"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className="font-medium hover:text-tom transition-colors max-w-[200px] truncate"
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => approveMut.mutate(p.id)}
                    aria-label="Aprovar"
                    className="w-5 h-5 grid place-items-center rounded text-success hover:bg-success/20"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectMut.mutate(p.id)}
                    aria-label="Rejeitar"
                    className="w-5 h-5 grid place-items-center rounded text-danger hover:bg-danger/20"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <SkeletonList count={6} variant="card" />
        ) : projects.length === 0 ? (
          <EmptyStateDesktop
            Icon={Rocket}
            title="Nenhum projeto ativo"
            description="Comece criando seu primeiro projeto para acompanhar tarefas, checkpoints e progresso."
            action={
              <button
                type="button"
                onClick={() => navigate('/projetos/novo')}
                className="h-9 px-4 rounded-md bg-tom text-white text-[13px] font-semibold hover:opacity-90 focus-ring"
              >
                Criar projeto
              </button>
            }
          />
        ) : view === 'kanban' ? (
          <KanbanBoard
            columns={columns}
            getItemKey={p => p.id}
            renderCard={p => <ProjectCardV2 project={p} onClick={() => setSelected(p)} />}
          />
        ) : (
          <DenseTable
            columns={tableColumns}
            rows={projects}
            getRowKey={p => p.id}
            onRowClick={p => setSelected(p)}
          />
        )}
      </PageShell>

      <ProjectDetailDrawer
        project={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
