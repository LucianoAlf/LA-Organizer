// Sheet de criação/edição de demanda operacional (tasks com department_id).
// Usado em /mais/operacoes (criar) e /mais/operacoes/:id (editar).
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { CustomSelect } from './CustomSelect';
import { DateInput } from './DateInput';
import { AssigneePicker } from './AssigneePicker';
import { showToast } from './Toast';
import type { Department, DepartmentRequestType, OperationalTask, TaskPriority } from '../types';

type Mode = { kind: 'create'; deptId?: string } | { kind: 'edit'; task: OperationalTask };

interface Props {
  open: boolean;
  onClose: () => void;
  mode: Mode;
}

const PRIORITY_OPTIONS = [
  { value: 'critical', label: '🔴 Urgente' },
  { value: 'high', label: '🟠 Alta' },
  { value: 'medium', label: '🟡 Média' },
  { value: 'low', label: '🟢 Baixa' },
];

export function DemandaSheet({ open, onClose, mode }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();

  const isEdit = mode.kind === 'edit';
  const initialTask = isEdit ? mode.task : null;
  const initialDeptId = isEdit ? mode.task.department_id ?? '' : (mode.kind === 'create' ? mode.deptId ?? '' : '');

  const [deptId, setDeptId] = useState<string>(initialDeptId);
  const [requestTypeId, setRequestTypeId] = useState<string>(initialTask?.request_type_id ?? '');
  const [title, setTitle] = useState<string>(initialTask?.title ?? '');
  const [description, setDescription] = useState<string>(initialTask?.description ?? '');
  const [assignedTo, setAssignedTo] = useState<string | null>(initialTask?.assigned_to ?? null);
  const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState<string>(initialTask?.due_date?.slice(0, 10) ?? '');

  // Reset state when sheet opens with different mode
  useEffect(() => {
    if (!open) return;
    if (isEdit && initialTask) {
      setDeptId(initialTask.department_id ?? '');
      setRequestTypeId(initialTask.request_type_id ?? '');
      setTitle(initialTask.title ?? '');
      setDescription(initialTask.description ?? '');
      setAssignedTo(initialTask.assigned_to ?? null);
      setPriority(initialTask.priority ?? 'medium');
      setDueDate(initialTask.due_date?.slice(0, 10) ?? '');
    } else {
      setDeptId(initialDeptId);
      setRequestTypeId('');
      setTitle('');
      setDescription('');
      setAssignedTo(null);
      setPriority('medium');
      setDueDate('');
    }
  }, [open, isEdit, initialTask, initialDeptId]);

  // Departamentos
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

  // Tipos do dept selecionado
  const { data: requestTypes = [] } = useQuery({
    queryKey: ['operational-types', deptId],
    queryFn: async () => {
      if (!deptId) return [];
      const { data, error } = await supabase
        .from('department_request_types')
        .select('id, department_id, slug, label, default_priority, requires_approval, generates_task, is_active, sort_order')
        .eq('department_id', deptId)
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as DepartmentRequestType[];
    },
    enabled: !!deptId,
  });

  // Colaboradores ativos pra atribuição
  const { data: collabs = [] } = useQuery({
    queryKey: ['active-collabs-for-assign'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Default priority quando muda o tipo
  function handleTypeChange(id: string) {
    setRequestTypeId(id);
    const rt = requestTypes.find(r => r.id === id);
    if (rt?.default_priority && !isEdit) {
      setPriority(rt.default_priority as TaskPriority);
    }
  }

  // Reset request type quando muda dept
  function handleDeptChange(id: string) {
    setDeptId(id);
    setRequestTypeId('');
  }

  const deptOptions = useMemo(
    () => depts.map(d => ({ value: d.id, label: d.name })),
    [depts],
  );
  const typeOptions = useMemo(
    () => requestTypes.map(r => ({ value: r.id, label: r.label })),
    [requestTypes],
  );
  const assigneeOptions = useMemo(
    () => collabs.map(c => ({ id: c.id, full_name: c.full_name })),
    [collabs],
  );

  const titleTrim = title.trim();
  const canSubmit = !!deptId && !!titleTrim && !!assignedTo && !!priority;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!collaborator?.id) throw new Error('sem auth');
      if (!canSubmit) throw new Error('campos faltando');
      const payload = {
        title: titleTrim,
        description: description.trim() || null,
        department_id: deptId,
        request_type_id: requestTypeId || null,
        assigned_to: assignedTo,
        created_by: collaborator.id,
        priority,
        status: 'pending',
        due_date: dueDate || null,
        context: 'work',
      };
      const { error } = await supabase.from('tasks').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operational-tasks'] });
      qc.invalidateQueries({ queryKey: ['operational-tasks-counts'] });
      showToast({ kind: 'success', title: 'Demanda criada' });
      onClose();
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao criar', msg: err.message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!isEdit || !initialTask) throw new Error('modo inválido');
      if (!canSubmit) throw new Error('campos faltando');
      const payload = {
        title: titleTrim,
        description: description.trim() || null,
        request_type_id: requestTypeId || null,
        assigned_to: assignedTo,
        priority,
        due_date: dueDate || null,
      };
      const { error } = await supabase.from('tasks').update(payload).eq('id', initialTask.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operational-tasks'] });
      qc.invalidateQueries({ queryKey: ['operational-tasks-counts'] });
      qc.invalidateQueries({ queryKey: ['operacao-detail', initialTask?.id] });
      showToast({ kind: 'success', title: 'Demanda atualizada' });
      onClose();
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao atualizar', msg: err.message });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit() {
    if (!canSubmit || isPending) return;
    if (isEdit) updateMutation.mutate();
    else createMutation.mutate();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={isEdit ? 'Editar demanda' : 'Nova demanda'}>
      <div className="space-y-4">
        <div>
          <label className="text-caption text-fg-muted block mb-1">Departamento</label>
          <CustomSelect
            value={deptId}
            options={deptOptions}
            onChange={handleDeptChange}
            placeholder="Selecione o departamento"
          />
        </div>

        {deptId && (
          <div>
            <label className="text-caption text-fg-muted block mb-1">Tipo de solicitação</label>
            <CustomSelect
              value={requestTypeId}
              options={typeOptions}
              onChange={handleTypeChange}
              placeholder="Selecione o tipo (opcional)"
            />
          </div>
        )}

        <div>
          <label className="text-caption text-fg-muted block mb-1">Título</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="O que precisa ser feito"
            className="w-full h-12 rounded-lg border border-border bg-bg-app px-3 text-body focus:outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Descrição (opcional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Detalhes, contexto, links…"
            className="w-full rounded-lg border border-border bg-bg-app px-3 py-2 text-body resize-none focus:outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="text-caption text-fg-muted block mb-1">Responsável</label>
          <AssigneePicker
            value={assignedTo}
            options={assigneeOptions}
            onChange={setAssignedTo}
            emptyLabel="Selecione"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-caption text-fg-muted block mb-1">Prioridade</label>
            <CustomSelect
              value={priority}
              options={PRIORITY_OPTIONS}
              onChange={(v) => setPriority(v as TaskPriority)}
            />
          </div>
          <div>
            <label className="text-caption text-fg-muted block mb-1">Prazo</label>
            <DateInput value={dueDate} onChange={setDueDate} />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending} fullWidth>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending} variant="primary" fullWidth>
            {isPending ? 'Salvando…' : (isEdit ? 'Salvar' : 'Criar')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
