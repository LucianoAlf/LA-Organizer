import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Filter as FilterIcon, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { unitLabel } from '../types';
import type { Department, DepartmentRequestType, OperationalTask, TaskPriority } from '../types';
import { STATUS_LABEL_OPERATIONAL, PRIORITY_INDICATOR } from '../types';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Tabs } from '../components/Tabs';
import { CustomSelect } from '../components/CustomSelect';
import { UnitFilterChips } from '../components/UnitFilterChips';
import { Fab } from '../components/Fab';
import { RowMenu } from '../components/RowMenu';
import { DemandaSheet } from '../components/DemandaSheet';
import { showToast } from '../components/Toast';
import { useSortableSensors } from '../lib/sortableSensors';
import { dragLiftStyle } from '../lib/sortableStyle';

const PRIORITY_ORDER: TaskPriority[] = ['critical', 'high', 'medium', 'low'];

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendente' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'awaiting_confirmation', label: 'Aguardando aprovação' },
];

function isOverdue(due: string | null | undefined): boolean {
  if (!due) return false;
  const today = new Date().toISOString().slice(0, 10);
  return due.slice(0, 10) < today;
}

function formatDueShort(due: string | null | undefined): string {
  if (!due) return '';
  const [, m, d] = due.slice(0, 10).split('-');
  return `${d}/${m}`;
}

// Local order persisted per dept (no DB column needed for now)
function loadOrder(deptId: string): string[] {
  if (!deptId || typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`op-cards-order:${deptId}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveOrder(deptId: string, ids: string[]) {
  if (!deptId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(`op-cards-order:${deptId}`, JSON.stringify(ids));
  } catch {
    // ignore quota errors
  }
}

export function OperacoesFilaTecnica() {
  const { role } = useAuth();
  const isDirector = role === 'director';
  const qc = useQueryClient();
  const sensors = useSortableSensors();

  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<OperationalTask | null>(null);

  // Local order — id list per priority bucket combined
  const [localOrder, setLocalOrder] = useState<string[]>([]);

  // Q1 — all active departments
  const { data: depts = [] } = useQuery({
    queryKey: ['operational-departments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, slug, name, is_active, unit_scope_enabled')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Department[];
    },
  });

  useEffect(() => {
    if (!selectedDeptId && depts.length > 0) {
      setSelectedDeptId(depts[0].id);
    }
  }, [depts, selectedDeptId]);

  // Reload order when dept changes
  useEffect(() => {
    if (selectedDeptId) {
      setLocalOrder(loadOrder(selectedDeptId));
    } else {
      setLocalOrder([]);
    }
  }, [selectedDeptId]);

  const dept = depts.find(d => d.id === selectedDeptId) ?? null;

  // Counts por dept
  const { data: deptCounts = {} } = useQuery({
    queryKey: ['operational-tasks-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('department_id, status')
        .not('department_id', 'is', null)
        .in('status', ['pending', 'in_progress', 'awaiting_confirmation']);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of data ?? []) {
        const k = (r as { department_id: string }).department_id;
        counts[k] = (counts[k] ?? 0) + 1;
      }
      return counts;
    },
  });

  const { data: requestTypes = [] } = useQuery({
    queryKey: ['operational-types', selectedDeptId],
    queryFn: async () => {
      if (!selectedDeptId) return [];
      const { data, error } = await supabase
        .from('department_request_types')
        .select('id, department_id, slug, label, default_priority, requires_approval, generates_task, is_active, sort_order')
        .eq('department_id', selectedDeptId)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as DepartmentRequestType[];
    },
    enabled: !!selectedDeptId,
  });

  const { data: tasks = [], isLoading, error: tasksError, refetch: refetchTasks } = useQuery({
    queryKey: ['operational-tasks', selectedDeptId],
    queryFn: async () => {
      if (!selectedDeptId) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          id, title, description, status, priority, due_date, notes,
          assigned_to, created_by,
          department_id, request_type_id,
          request_type:department_request_types!tasks_request_type_id_fkey(id, slug, label),
          department:departments!tasks_department_id_fkey(id, slug, name),
          collaborator:collaborators!tasks_assigned_to_fkey(id, full_name, unit)
        `)
        .eq('department_id', selectedDeptId)
        .in('status', ['pending', 'in_progress', 'awaiting_confirmation'])
        .order('priority', { ascending: false })
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as OperationalTask[];
    },
    enabled: !!selectedDeptId,
  });

  const { data: deptAssignees = [] } = useQuery({
    queryKey: ['dept-assignees', dept?.slug ?? ''],
    queryFn: async () => {
      if (!dept) return [] as Array<{ id: string; full_name: string }>;
      if (dept.slug === 'pedagogico') {
        const { data, error } = await supabase
          .from('collaborators')
          .select('id, full_name, pedagogical_role')
          .not('pedagogical_role', 'is', null)
          .order('full_name');
        if (error) throw error;
        return (data ?? []) as Array<{ id: string; full_name: string }>;
      }
      if (dept.slug === 'gerencia') {
        const { data, error } = await supabase
          .from('collaborators')
          .select('id, full_name, role, unit')
          .in('role', ['manager', 'coordinator', 'director'])
          .eq('is_active', true)
          .order('full_name');
        if (error) throw error;
        return (data ?? []) as Array<{ id: string; full_name: string }>;
      }
      return [];
    },
    enabled: !!dept,
  });

  const responsibles = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of deptAssignees) {
      if (c?.id && c.full_name) m.set(c.id, c.full_name);
    }
    for (const t of tasks) {
      if (t.collaborator?.id && t.collaborator.full_name) {
        m.set(t.collaborator.id, t.collaborator.full_name);
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks, deptAssignees]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (unitFilter && t.collaborator?.unit !== unitFilter) return false;
      if (typeFilter && t.request_type_id !== typeFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (responsibleFilter && t.collaborator?.id !== responsibleFilter) return false;
      return true;
    });
  }, [tasks, unitFilter, typeFilter, statusFilter, responsibleFilter]);

  // Sort each priority bucket using localOrder; tasks not in localOrder use natural order
  const grouped = useMemo(() => {
    const map = new Map<TaskPriority, OperationalTask[]>();
    for (const p of PRIORITY_ORDER) map.set(p, []);
    for (const t of filteredTasks) {
      const bucket = map.get(t.priority);
      if (bucket) bucket.push(t);
    }
    if (localOrder.length > 0) {
      const orderRank = new Map<string, number>();
      localOrder.forEach((id, i) => orderRank.set(id, i));
      for (const p of PRIORITY_ORDER) {
        const bucket = map.get(p) ?? [];
        bucket.sort((a, b) => {
          const ra = orderRank.has(a.id) ? orderRank.get(a.id)! : 9999;
          const rb = orderRank.has(b.id) ? orderRank.get(b.id)! : 9999;
          if (ra !== rb) return ra - rb;
          return 0;
        });
      }
    }
    return map;
  }, [filteredTasks, localOrder]);

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (unitFilter) n++;
    if (typeFilter) n++;
    if (statusFilter) n++;
    if (responsibleFilter) n++;
    return n;
  }, [unitFilter, typeFilter, statusFilter, responsibleFilter]);

  function clearFilters() {
    setUnitFilter(null);
    setTypeFilter('');
    setStatusFilter('');
    setResponsibleFilter('');
  }

  function handleTabChange(id: string) {
    setSelectedDeptId(id);
    clearFilters();
  }

  const cancelMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operational-tasks'] });
      qc.invalidateQueries({ queryKey: ['operational-tasks-counts'] });
      showToast({ kind: 'success', title: 'Demanda cancelada' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao cancelar', msg: err.message });
    },
  });

  function handleDragEnd(priority: TaskPriority) {
    return (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const bucket = grouped.get(priority) ?? [];
      const oldIdx = bucket.findIndex(t => t.id === active.id);
      const newIdx = bucket.findIndex(t => t.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      const reorderedBucket = arrayMove(bucket, oldIdx, newIdx);

      // Rebuild full order across all priorities preserving non-bucket positions
      const allIds: string[] = [];
      for (const p of PRIORITY_ORDER) {
        if (p === priority) {
          allIds.push(...reorderedBucket.map(t => t.id));
        } else {
          allIds.push(...(grouped.get(p) ?? []).map(t => t.id));
        }
      }
      setLocalOrder(allIds);
      saveOrder(selectedDeptId, allIds);
    };
  }

  const DEPT_LABEL_OVERRIDE: Record<string, string> = {
    'operacoes-tecnicas': 'Técnica',
  };
  const tabsItems = depts.map(d => ({
    id: d.id,
    label: DEPT_LABEL_OVERRIDE[d.slug] ?? d.name,
    badge: deptCounts[d.id] ? deptCounts[d.id] : undefined,
  }));

  return (
    <div className="space-y-md">
      <PageHeader title="Operações" subtitle="por departamento" backTo="/mais" />

      {depts.length > 0 && (
        <Tabs<string>
          tabs={tabsItems}
          active={selectedDeptId}
          onChange={handleTabChange}
        />
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setFiltersOpen(v => !v)}
            className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm"
          >
            <FilterIcon size={16} />
            <span>Filtros{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}</span>
          </button>
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-caption text-brand underline focus-ring rounded-sm"
            >
              Limpar
            </button>
          )}
        </div>

        {filtersOpen && (
          <div className="bg-bg-surface rounded-xl border border-border p-4 space-y-3">
            {isDirector && (
              <div>
                <label className="text-caption text-fg-muted block mb-1">Unidade</label>
                <UnitFilterChips value={unitFilter} onChange={setUnitFilter} />
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-caption text-fg-muted block mb-1">Tipo</label>
                <CustomSelect
                  value={typeFilter}
                  options={[{ value: '', label: 'Todos os tipos' }, ...requestTypes.map(rt => ({ value: rt.id, label: rt.label }))]}
                  onChange={setTypeFilter}
                  size="sm"
                />
              </div>
              <div>
                <label className="text-caption text-fg-muted block mb-1">Status</label>
                <CustomSelect value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} size="sm" />
              </div>
              <div>
                <label className="text-caption text-fg-muted block mb-1">Responsável</label>
                <CustomSelect
                  value={responsibleFilter}
                  options={[{ value: '', label: 'Todos' }, ...responsibles.map(([id, name]) => ({ value: id, label: name }))]}
                  onChange={setResponsibleFilter}
                  size="sm"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {isLoading ? (
        <LoadingState rows={3} />
      ) : tasksError ? (
        <ErrorState
          title="Não consegui carregar a fila"
          description={(tasksError as Error).message}
          onRetry={() => refetchTasks()}
        />
      ) : filteredTasks.length === 0 ? (
        <EmptyState
          title="Sem demandas ativas"
          description={`Nenhuma demanda operacional ativa em ${dept?.name ?? 'este departamento'}.`}
        />
      ) : (
        <div className="space-y-6">
          {PRIORITY_ORDER.map(priority => {
            const bucket = grouped.get(priority) ?? [];
            if (bucket.length === 0) return null;
            const { emoji } = PRIORITY_INDICATOR[priority];
            return (
              <section key={priority}>
                <h3 className="text-body-sm font-semibold text-fg-muted uppercase mb-2 flex items-center gap-1">
                  <span>{emoji}</span>
                  <span>
                    {priority === 'critical' && 'Urgente'}
                    {priority === 'high' && 'Alta'}
                    {priority === 'medium' && 'Média'}
                    {priority === 'low' && 'Baixa'}
                  </span>
                  <span className="ml-1 text-caption">({bucket.length})</span>
                </h3>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(priority)}>
                  <SortableContext items={bucket.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3">
                      {bucket.map(t => (
                        <SortableDemandaCard
                          key={t.id}
                          task={t}
                          onEdit={() => setEditTask(t)}
                          onCancel={() => cancelMutation.mutate(t.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </section>
            );
          })}
        </div>
      )}

      <Fab onClick={() => setCreateOpen(true)} label="Nova" ariaLabel="Nova demanda" />

      <DemandaSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        mode={{ kind: 'create', deptId: selectedDeptId }}
      />

      {editTask && (
        <DemandaSheet
          open={!!editTask}
          onClose={() => setEditTask(null)}
          mode={{ kind: 'edit', task: editTask }}
        />
      )}
    </div>
  );
}

interface CardProps {
  task: OperationalTask;
  onEdit: () => void;
  onCancel: () => void;
}

function SortableDemandaCard({ task: t, onEdit, onCancel }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
  });
  const baseStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const overdue = isOverdue(t.due_date);
  return (
    <div
      ref={setNodeRef}
      style={dragLiftStyle(isDragging, baseStyle)}
      className={[
        'relative bg-bg-surface rounded-xl border border-border p-4',
        'transition-all duration-150',
        'hover:border-tom/40 hover:shadow-[0_0_0_1px_rgba(157,184,91,0.15),0_8px_24px_-12px_rgba(157,184,91,0.30)]',
        isDragging ? 'shadow-soft' : '',
      ].join(' ')}
      {...attributes}
    >
      {/* Drag handle column */}
      <span
        aria-label="Arrastar pra reordenar"
        className="absolute left-1.5 top-0 bottom-0 grid place-items-center text-fg-muted/40 hover:text-fg-muted cursor-grab touch-none px-0.5"
        {...listeners}
      >
        <GripVertical size={14} />
      </span>

      <Link to={`/mais/operacoes/${t.id}`} className="block space-y-1 pl-6 pr-8">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg">{PRIORITY_INDICATOR[t.priority].emoji}</span>
            <span className="text-caption uppercase font-semibold text-fg-muted truncate">
              {t.request_type?.label ?? '—'}
            </span>
          </div>
          {t.due_date && (
            <span
              className={
                overdue
                  ? 'text-caption font-semibold text-danger whitespace-nowrap'
                  : 'text-caption text-fg-muted whitespace-nowrap'
              }
            >
              {overdue ? '⚠ ' : ''}{formatDueShort(t.due_date)}
            </span>
          )}
        </div>
        <p className="text-body font-medium text-fg">{t.title}</p>
        <p className="text-body-sm text-fg-muted">
          {unitLabel(t.collaborator?.unit ?? null)}
          {' · '}
          {t.collaborator?.full_name ?? '—'}
          {' · '}
          {STATUS_LABEL_OPERATIONAL[t.status] ?? t.status}
        </p>
        {t.notes && (
          <p className="text-caption text-fg-muted italic line-clamp-1">{t.notes}</p>
        )}
      </Link>

      <div className="absolute top-3 right-3">
        <RowMenu
          items={[
            { label: 'Editar', onClick: onEdit },
            {
              label: 'Cancelar demanda',
              danger: true,
              confirm: 'Cancelar essa demanda?',
              onClick: onCancel,
            },
          ]}
        />
      </div>
    </div>
  );
}
