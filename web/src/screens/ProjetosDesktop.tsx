import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Rocket, Check, X as XIcon, GanttChart, CalendarDays } from 'lucide-react';
import { PageShell } from '../design/primitives/PageShell';
import { Toolbar } from '../design/primitives/Toolbar';
import { ViewSwitcher } from '../design/primitives/ViewSwitcher';
import { FilterPill } from '../design/primitives/FilterPill';
import { EmptyStateDesktop } from '../design/primitives/EmptyStateDesktop';
import { SkeletonList } from '../design/primitives/LoadingSkeleton';
import { KanbanBoard } from '../design/views/KanbanBoard';
import { DenseTable } from '../design/views/DenseTable';
import type { DenseTableColumn } from '../design/views/DenseTable';
import { TimelineGantt } from '../design/views/TimelineGantt';
import type { TimelineItem } from '../design/views/TimelineGantt';
import { MonthCalendar } from '../design/views/MonthCalendar';
import type { CalendarItem } from '../design/views/MonthCalendar';
import { ProjectCardV2 } from './projetos/ProjectCardV2';
import { ProjectDetailDrawer } from './projetos/ProjectDetailDrawer';
import { KANBAN_COLUMNS, CATEGORY_BADGE, groupByStatus } from './projetos/constants';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { showToast } from '../components/Toast';
import type { Project, ProjectStatus } from '../types';

type ViewMode = 'kanban' | 'list' | 'timeline' | 'calendar';

const TODAY = new Date();
const STATUS_COLORS: Record<string, string> = {
  pending_approval: '#F59E0B',
  planning: '#60a5fa',
  active: '#A3BE50',
  paused: '#9E9E9E',
  completed: '#22C55E',
  cancelled: '#EF4444',
};

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

export function ProjetosDesktop() {
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

  // DnD do Kanban: arrastar card entre colunas muda o status do projeto.
  const moveStatusMut = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: ProjectStatus }) => {
      const { error } = await supabase.from('projects').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, newStatus }) => {
      // Update otimista: move o card visualmente antes do round-trip.
      await qc.cancelQueries({ queryKey: ['projects'] });
      const prev = qc.getQueryData<Project[]>(['projects', collaborator?.id, isCoordOrDir]);
      if (prev) {
        qc.setQueryData<Project[]>(
          ['projects', collaborator?.id, isCoordOrDir],
          prev.map(p => (p.id === id ? { ...p, status: newStatus } : p)),
        );
      }
      return { prev };
    },
    onError: (err: Error, _vars, ctx) => {
      // Rollback otimista em caso de erro.
      if (ctx?.prev) qc.setQueryData(['projects', collaborator?.id, isCoordOrDir], ctx.prev);
      showToast({ kind: 'error', title: 'Erro ao mover', msg: err.message });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
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
                    { id: 'kanban',   label: 'Kanban',     Icon: LayoutGrid },
                    { id: 'list',     label: 'Lista',      Icon: List },
                    { id: 'timeline', label: 'Linha do tempo', Icon: GanttChart },
                    { id: 'calendar', label: 'Calendário', Icon: CalendarDays },
                  ]}
                  value={view}
                  onChange={setView}
                />
                <button
                  type="button"
                  onClick={() => navigate('/projetos/novo')}
                  className="h-8 px-3 rounded-md bg-tom text-black text-[12px] font-semibold hover:opacity-90 focus-ring"
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
                className="h-9 px-4 rounded-md bg-tom text-black text-[13px] font-semibold hover:opacity-90 focus-ring"
              >
                Criar projeto
              </button>
            }
          />
        ) : view === 'kanban' ? (
          <KanbanBoard
            columns={columns}
            getItemKey={p => p.id}
            renderCard={(p, _colId, dragHandle) => (
              <ProjectCardV2 project={p} onClick={() => setSelected(p)} dragHandle={dragHandle} />
            )}
            onMoveItem={(itemId, fromCol, toCol) => {
              if (fromCol === toCol) return; // reorder dentro da mesma coluna: ignorar (futuro: sort_position)
              moveStatusMut.mutate({ id: itemId, newStatus: toCol as ProjectStatus });
            }}
          />
        ) : view === 'list' ? (
          <DenseTable
            columns={tableColumns}
            rows={projects}
            getRowKey={p => p.id}
            onRowClick={p => setSelected(p)}
          />
        ) : view === 'timeline' ? (
          (() => {
            // Timeline: projetos com start_date+end_date, lanes por status.
            const datedProjects = projects.filter(p => p.start_date && p.end_date);
            if (datedProjects.length === 0) {
              return (
                <EmptyStateDesktop
                  Icon={GanttChart}
                  title="Sem datas para plotar"
                  description="A linha do tempo precisa que os projetos tenham data de início e fim cadastradas."
                />
              );
            }
            const items: TimelineItem[] = datedProjects.map(p => ({
              id: p.id,
              label: p.name,
              start: new Date(p.start_date!).getTime(),
              end: new Date(p.end_date!).getTime(),
              lane: p.status,
              color: STATUS_COLORS[p.status],
            }));
            const lanes = KANBAN_COLUMNS.map(c => ({ id: c.id, label: c.title }));
            const starts = items.map(i => i.start);
            const ends = items.map(i => i.end);
            const rangeStart = Math.min(...starts, TODAY.getTime() - 7 * 86400000);
            const rangeEnd = Math.max(...ends, TODAY.getTime() + 30 * 86400000);
            return (
              <div className="h-[600px]">
                <TimelineGantt
                  items={items}
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  lanes={lanes}
                  onItemClick={it => {
                    const proj = projects.find(p => p.id === it.id);
                    if (proj) setSelected(proj);
                  }}
                />
              </div>
            );
          })()
        ) : (
          (() => {
            // Calendar: projetos plotados na sua start_date.
            const datedProjects = projects.filter(p => p.start_date);
            const items: CalendarItem[] = datedProjects.map(p => ({
              id: p.id,
              date: p.start_date!.slice(0, 10), // YYYY-MM-DD
              label: p.name,
              color: STATUS_COLORS[p.status],
            }));
            return (
              <div className="h-[600px]">
                <MonthCalendar
                  year={TODAY.getFullYear()}
                  month={TODAY.getMonth() + 1}
                  items={items}
                  onDayClick={date => {
                    const proj = projects.find(p => p.start_date?.slice(0, 10) === date);
                    if (proj) setSelected(proj);
                  }}
                />
              </div>
            );
          })()
        )}
      </PageShell>

      <ProjectDetailDrawer
        project={selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
