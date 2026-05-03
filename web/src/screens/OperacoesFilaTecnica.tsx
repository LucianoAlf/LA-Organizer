import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { unitLabel } from '../types';
import type { Department, DepartmentRequestType, OperationalTask, TaskPriority } from '../types';
import { STATUS_LABEL_OPERATIONAL, PRIORITY_INDICATOR } from '../types';

const PRIORITY_ORDER: TaskPriority[] = ['critical', 'high', 'medium', 'low'];

const UNIT_OPTIONS = [
  { value: '', label: 'Todas as unidades' },
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendente' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'awaiting_confirmation', label: 'Aguardando aprovação' },
];

const SELECT_CLASS =
  'mt-1 rounded-lg border border-border bg-bg-surface px-2 py-1 text-body-sm text-fg focus:outline-none focus:border-brand';

export function OperacoesFilaTecnica() {
  const [unitFilter, setUnitFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');

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

  const dept = depts.find(d => d.id === selectedDeptId) ?? null;

  // Q1b — request types for selected dept
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

  // Q2 — task queue for selected dept
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['operational-tasks', selectedDeptId],
    queryFn: async () => {
      if (!selectedDeptId) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          id, title, description, status, priority, due_date, notes,
          assigned_to,
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

  // Build unique responsibles from results
  const responsibles = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      if (t.collaborator?.id && t.collaborator.full_name) {
        m.set(t.collaborator.id, t.collaborator.full_name);
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (unitFilter && t.collaborator?.unit !== unitFilter) return false;
      if (typeFilter && t.request_type_id !== typeFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (responsibleFilter && t.collaborator?.id !== responsibleFilter) return false;
      return true;
    });
  }, [tasks, unitFilter, typeFilter, statusFilter, responsibleFilter]);

  // Group by priority
  const grouped = useMemo(() => {
    const map = new Map<TaskPriority, OperationalTask[]>();
    for (const p of PRIORITY_ORDER) map.set(p, []);
    for (const t of filteredTasks) {
      const bucket = map.get(t.priority);
      if (bucket) bucket.push(t);
    }
    return map;
  }, [filteredTasks]);

  return (
    <div className="space-y-lg">
      <header className="space-y-1">
        <h2 className="text-title text-fg">Operações</h2>
        <p className="text-body-sm text-fg-muted">Fila de demandas operacionais por departamento</p>
      </header>

      {/* Department tabs */}
      <div className="flex gap-2 border-b border-border overflow-x-auto">
        {depts.map(d => (
          <button
            key={d.id}
            type="button"
            onClick={() => {
              setSelectedDeptId(d.id);
              setUnitFilter('');
              setTypeFilter('');
              setStatusFilter('');
              setResponsibleFilter('');
            }}
            className={[
              'px-3 py-2 text-body focus-ring whitespace-nowrap',
              d.id === selectedDeptId
                ? 'border-b-2 border-brand text-fg font-medium'
                : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            {d.name}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <section className="bg-bg-surface rounded-xl border border-border p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col">
            <label className="text-caption text-fg-muted">Unidade</label>
            <select
              value={unitFilter}
              onChange={e => setUnitFilter(e.target.value)}
              className={SELECT_CLASS}
            >
              {UNIT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-caption text-fg-muted">Tipo</label>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todos os tipos</option>
              {requestTypes.map(rt => (
                <option key={rt.id} value={rt.id}>{rt.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-caption text-fg-muted">Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className={SELECT_CLASS}
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-caption text-fg-muted">Responsável</label>
            <select
              value={responsibleFilter}
              onChange={e => setResponsibleFilter(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Todos</option>
              {responsibles.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Content */}
      {isLoading ? (
        <p className="text-body-sm text-fg-muted">Carregando fila operacional...</p>
      ) : filteredTasks.length === 0 ? (
        <p className="text-body-sm text-fg-muted">Nenhuma demanda operacional ativa em {dept?.name ?? 'este departamento'}.</p>
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
                    {priority === 'critical' && 'Crítico'}
                    {priority === 'high' && 'Alto'}
                    {priority === 'medium' && 'Médio'}
                    {priority === 'low' && 'Baixo'}
                  </span>
                  <span className="ml-1 text-caption">({bucket.length})</span>
                </h3>
                <div className="space-y-3">
                  {bucket.map(t => (
                    <Link
                      key={t.id}
                      to={`/mais/operacoes/${t.id}`}
                      className="block bg-bg-surface rounded-xl border border-border p-4 space-y-1 cursor-pointer hover:bg-bg-elevated transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{PRIORITY_INDICATOR[t.priority].emoji}</span>
                        <span className="text-caption uppercase font-semibold text-fg-muted">
                          {t.request_type?.label ?? '—'}
                        </span>
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
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
