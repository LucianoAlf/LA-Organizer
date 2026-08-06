// web/src/components/TaskGroupSheet.tsx
// Detalhe do grupo (tela aprovada): ciclo inteiro, DnD, add inline, conclusão em cascata.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortableSensors } from '../lib/sortableSensors';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { DateInput } from './DateInput';
import { DayOfMonthInput } from './DayOfMonthInput';
import { TaskCheckbox } from './TaskCheckbox';
import { ConfirmDialog } from './ConfirmDialog';
import { RecurrenceScopeDialog } from './RecurrenceScopeDialog';
import { RowMenu, type MenuItem } from './RowMenu';
import { showToast } from './Toast';
import {
  fetchGroup, toggleChildWithCascade, completeGroupCascade,
  addSubtask, removeSubtask, reorderSubtasks, cycleLabel,
  renameGroup, deleteGroup, setGroupDueDate,
} from '../lib/taskGroups';
import { dayOfMonthToYmd } from '../lib/taskGroupDates';
import { todaySP } from '../utils/date';
import type { Task } from '../types';

interface Props {
  open: boolean;
  groupId: string | null;
  onClose: () => void;
  /** Abre o EditTaskSheet da filha no parent (edição completa de data/hora/lembretes). */
  onEditChild?: (child: Task) => void;
}

function SortableChildRow({ child, onToggle, onEdit, onDelete }: {
  child: Task;
  onToggle: (done: boolean) => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: child.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    zIndex: isDragging ? 50 : undefined,
  };
  const isDone = child.status === 'done';
  const hm = child.due_time ? child.due_time.slice(0, 5) : null;
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-2 border-b border-border/60 last:border-b-0">
      <button type="button" {...attributes} {...listeners} aria-label="Reordenar"
        className="cursor-grab active:cursor-grabbing p-0.5 text-fg-muted/40 hover:text-fg-muted" style={{ touchAction: 'none' }}>
        <GripVertical size={14} />
      </button>
      <TaskCheckbox done={isDone} size="sm" onClick={() => onToggle(!isDone)} />
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left focus-ring rounded-sm">
        <span className={['text-body-sm', isDone ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>{child.title}</span>
      </button>
      <span className="text-body-sm text-fg-muted tabular-nums shrink-0">
        {child.due_date ? `dia ${Number(child.due_date.slice(8, 10))}` : 'sem prazo'}{hm ? ` · 🕐 ${hm}` : ''}
      </span>
      <button type="button" onClick={onDelete} aria-label="Remover subtarefa"
        className="p-1 text-fg-muted hover:text-danger focus-ring rounded-sm">✕</button>
    </div>
  );
}

export function TaskGroupSheet({ open, groupId, onClose, onEditChild }: Props) {
  const qc = useQueryClient();
  const sensors = useSortableSensors();
  const [confirmAll, setConfirmAll] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Task | null>(null);
  // confirmRemove: usado para grupos NÃO-recorrentes (confirmar antes de deletar direto)
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDay, setNewDay] = useState('');
  const [scopeFor, setScopeFor] = useState<'add' | 'remove' | 'rename' | 'delete' | 'due' | null>(null);
  // Renomear grupo
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [groupRenameValue, setGroupRenameValue] = useState('');
  // Editar prazo do grupo (Rose 05/08). Draft: YMD no grupo simples, dia 1-31 no mensal.
  const [editingDue, setEditingDue] = useState(false);
  const [dueDraft, setDueDraft] = useState('');
  // Confirmar apagar grupo (não-recorrente)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);

  const groupQ = useQuery({
    queryKey: ['task-group', groupId],
    enabled: open && Boolean(groupId),
    queryFn: () => fetchGroup(groupId!),
  });
  const group = groupQ.data ?? null;
  const kids = group?.subtasks ?? [];
  const total = kids.filter(k => k.status !== 'cancelled').length;
  const done = kids.filter(k => k.status === 'done').length;
  const openCount = total - done;
  const isRecurrentInstance = Boolean(group?.recurrence_parent_id);

  useEffect(() => {
    if (!open) {
      setNewTitle(''); setNewDay(''); setScopeFor(null); setPendingRemove(null);
      setConfirmRemove(false); setRenamingGroup(false); setGroupRenameValue('');
      setConfirmDeleteGroup(false); setEditingDue(false); setDueDraft('');
    }
  }, [open]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-group', groupId] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['task-groups'] });
  };

  const toggleMut = useMutation({
    mutationFn: ({ child, done: d }: { child: Task; done: boolean }) => toggleChildWithCascade(child, d),
    onSuccess: (r) => {
      invalidate();
      if (r.groupCompleted) showToast({ kind: 'success', title: '🎉 Grupo concluído!', msg: `${group?.title ?? ''} fechado.` });
    },
  });
  const completeAllMut = useMutation({
    mutationFn: () => completeGroupCascade(groupId!),
    onSuccess: () => { invalidate(); showToast({ kind: 'success', title: '🎉 Grupo concluído!' }); setConfirmAll(false); },
  });
  const reorderMut = useMutation({
    mutationFn: (ordered: Array<{ id: string; sort_position: number }>) => reorderSubtasks(ordered),
    onSuccess: invalidate,
  });
  const addMut = useMutation({
    mutationFn: (scope: 'only_this' | 'this_and_future') =>
      addSubtask(group!, newTitle, newDay ? Number(newDay) : null, scope),
    onSuccess: () => { setNewTitle(''); setNewDay(''); invalidate(); },
  });
  const removeMut = useMutation({
    mutationFn: ({ child, scope }: { child: Task; scope: 'only_this' | 'this_and_future' }) =>
      removeSubtask(child, scope),
    onSuccess: invalidate,
  });
  const renameMut = useMutation({
    mutationFn: ({ title, scope }: { title: string; scope: 'only_this' | 'this_and_future' }) =>
      renameGroup(group!, title, scope),
    onSuccess: () => {
      setRenamingGroup(false); setGroupRenameValue('');
      qc.invalidateQueries({ queryKey: ['task-group', groupId] });
      qc.invalidateQueries({ queryKey: ['task-groups'] });
      showToast({ kind: 'success', title: 'Grupo renomeado.' });
    },
  });
  const dueMut = useMutation({
    mutationFn: (scope: 'only_this' | 'this_and_future') => setGroupDueDate(group!, computeNewDue(), scope),
    onSuccess: () => {
      setEditingDue(false); setDueDraft('');
      invalidate();
      showToast({ kind: 'success', title: 'Prazo do grupo atualizado.' });
    },
  });
  const deleteGroupMut = useMutation({
    mutationFn: (scope: 'only_this' | 'this_and_future') => deleteGroup(group!, scope),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-groups'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['agenda-tasks'] });
      showToast({ kind: 'success', title: 'Grupo apagado.' });
      onClose();
    },
  });

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id || !group) return;
    const oldIndex = kids.findIndex(k => k.id === active.id);
    const newIndex = kids.findIndex(k => k.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = [...kids];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    reorderMut.mutate(reordered.map((k, i) => ({ id: k.id, sort_position: i + 1 })));
  }

  function submitAdd() {
    if (!newTitle.trim() || !group) return;
    if (isRecurrentInstance) setScopeFor('add');
    else addMut.mutate('only_this');
  }

  /** Prazo do grupo: mensal = dia dentro do mês do ciclo (clamp em mês curto); simples = YMD. */
  function computeNewDue(): string | null {
    if (!group) return null;
    if (!isRecurrentInstance) return dueDraft || null;
    if (!dueDraft) return null;
    return dayOfMonthToYmd(Number(dueDraft), group.due_date ?? todaySP());
  }

  function openDueEditor() {
    if (!group) return;
    setDueDraft(
      group.due_date
        ? (isRecurrentInstance ? String(Number(group.due_date.slice(8, 10))) : group.due_date)
        : ''
    );
    setEditingDue(true);
  }

  function submitDue() {
    if (!group) return;
    // Mensal: o due da mãe É a âncora do ciclo — esvaziar quebraria o card. Simples: pode ficar sem prazo.
    if (isRecurrentInstance) {
      if (!dueDraft) return;
      setScopeFor('due');
    } else {
      dueMut.mutate('only_this');
    }
  }

  function submitRemove(child: Task) {
    setPendingRemove(child);
    if (isRecurrentInstance && child.recurrence_parent_id) {
      // Instância recorrente com template-filho: abre RecurrenceScopeDialog
      setScopeFor('remove');
    } else {
      // Grupo não-recorrente OU filha sem recurrence_parent_id:
      // pede confirmação simples antes de deletar direto
      setConfirmRemove(true);
    }
  }

  return (
    <AdaptiveSheet open={open && Boolean(group)} onClose={onClose} title={group ? group.title : 'Grupo'} size="md">
      {group && (
        <div className="space-y-md">
          {/* Ações do grupo */}
          <div className="flex items-center justify-end">
            <RowMenu items={[
              {
                label: 'Renomear grupo',
                onClick: () => { setGroupRenameValue(group.title); setRenamingGroup(true); },
              },
              {
                label: 'Apagar grupo',
                danger: true,
                onClick: () => {
                  if (isRecurrentInstance) setScopeFor('delete');
                  else setConfirmDeleteGroup(true);
                },
              },
            ] satisfies MenuItem[]} />
          </div>

          {/* Form inline de renomear */}
          {renamingGroup && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-bg-elevated/50">
              <p className="text-body-sm text-fg-muted font-medium">Renomear grupo</p>
              <input
                type="text"
                maxLength={200}
                autoFocus
                value={groupRenameValue}
                onChange={e => setGroupRenameValue(e.target.value)}
                className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setRenamingGroup(false); setGroupRenameValue(''); }}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={!groupRenameValue.trim() || renameMut.isPending}
                  onClick={() => {
                    if (!groupRenameValue.trim()) return;
                    if (isRecurrentInstance) setScopeFor('rename');
                    else renameMut.mutate({ title: groupRenameValue, scope: 'only_this' });
                  }}
                >
                  Salvar
                </Button>
              </div>
            </div>
          )}

          <div className="text-body-sm text-fg-muted">
            🗂️ grupo{isRecurrentInstance ? ' · 🔁 renasce todo mês' : ''} · {done}/{total}
            {isRecurrentInstance && group.due_date ? ` em ${cycleLabel(group.due_date)}` : ''}
          </div>
          <div className="h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-tom transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={kids.map(k => k.id)} strategy={verticalListSortingStrategy}>
              {kids.map(k => (
                <SortableChildRow key={k.id} child={k}
                  onToggle={(d) => toggleMut.mutate({ child: k, done: d })}
                  onEdit={onEditChild ? () => onEditChild(k) : undefined}
                  onDelete={() => submitRemove(k)} />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add inline: título + dia do mês (1-31) */}
          <div className="rounded-md border border-dashed border-border p-3 space-y-2 bg-bg-elevated/50">
            <input type="text" maxLength={200} value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Nova subtarefa…"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom" />
            <div className="flex items-center gap-2">
              <input type="text" inputMode="numeric" maxLength={2} value={newDay}
                onChange={e => setNewDay(e.target.value.replace(/\D/g, ''))}
                placeholder={isRecurrentInstance ? 'dia (1-31)' : 'dia'}
                className="w-24 bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom" />
              <Button size="sm" disabled={!newTitle.trim() || addMut.isPending} onClick={submitAdd}>Adicionar</Button>
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-2 text-body-sm text-fg-muted">
            {/* Prazo do grupo — editável (Rose 05/08: "não consigo editar dps de criado") */}
            <div className="flex items-center gap-2 flex-wrap">
              <span>📅 Prazo do grupo:</span>
              <button
                type="button"
                onClick={openDueEditor}
                className="text-fg underline decoration-dotted underline-offset-2 hover:text-tom focus-ring rounded-sm"
              >
                {!group.due_date
                  ? 'sem prazo'
                  : isRecurrentInstance
                    ? `dia ${Number(group.due_date.slice(8, 10))}`
                    : group.due_date.split('-').reverse().join('/')}
              </button>
            </div>

            {editingDue && (
              <div className="rounded-md border border-border p-3 space-y-2 bg-bg-elevated/50">
                <p className="text-body-sm text-fg-muted font-medium">Editar prazo do grupo</p>
                {isRecurrentInstance ? (
                  <DayOfMonthInput value={dueDraft} onChange={setDueDraft} placeholder="dia (1-31)" />
                ) : (
                  <DateInput value={dueDraft} onChange={setDueDraft} />
                )}
                <p className="text-body-sm text-fg-muted">
                  {isRecurrentInstance
                    ? `Dia do ciclo${group.due_date ? ` de ${cycleLabel(group.due_date)}` : ''}. Cada subtarefa mantém o prazo dela.`
                    : 'Cada subtarefa mantém o prazo dela.'}
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="secondary" onClick={() => { setEditingDue(false); setDueDraft(''); }}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    disabled={dueMut.isPending || (isRecurrentInstance && !dueDraft)}
                    onClick={submitDue}
                  >
                    Salvar
                  </Button>
                </div>
              </div>
            )}

            <div>🔁 Repetição: {isRecurrentInstance ? 'Mensal' : 'Não repete'}</div>
            <div>💬 TOM lembra cada subtarefa no prazo dela · <span className="text-tom">ativo</span></div>
          </div>

          <div className="flex items-center gap-md pt-1">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button fullWidth disabled={openCount === 0 || completeAllMut.isPending}
              onClick={() => setConfirmAll(true)}>
              Concluir grupo{openCount > 0 ? ` (${openCount} abertas)` : ''}
            </Button>
          </div>
        </div>
      )}

      {/* Confirmação: concluir todo o grupo em cascata */}
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={`Concluir "${group?.title ?? ''}"?`}
        description={openCount > 0 ? `As ${openCount} subtarefas abertas também serão concluídas.` : 'O grupo será concluído.'}
        confirmLabel="Concluir tudo"
        confirmVariant="primary"
        onConfirm={() => completeAllMut.mutate()}
        isPending={completeAllMut.isPending}
      />

      {/* Confirmação: remover subtarefa em grupo NÃO-recorrente */}
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => { setConfirmRemove(false); setPendingRemove(null); }}
        title="Remover subtarefa?"
        description={pendingRemove ? `"${pendingRemove.title}" será removida do grupo.` : undefined}
        confirmLabel="Remover"
        confirmVariant="danger"
        onConfirm={() => {
          if (pendingRemove) removeMut.mutate({ child: pendingRemove, scope: 'only_this' });
          setConfirmRemove(false);
          setPendingRemove(null);
        }}
        isPending={removeMut.isPending}
      />

      {/* Confirmar apagar grupo não-recorrente */}
      <ConfirmDialog
        open={confirmDeleteGroup}
        onClose={() => setConfirmDeleteGroup(false)}
        title={`Apagar "${group?.title ?? ''}"?`}
        description="O grupo e todas as subtarefas serão apagados permanentemente."
        confirmLabel="Apagar"
        confirmVariant="danger"
        onConfirm={() => { deleteGroupMut.mutate('only_this'); setConfirmDeleteGroup(false); }}
        isPending={deleteGroupMut.isPending}
      />

      {/* Escopo: ações em grupo recorrente (add/remove subtarefa, rename/delete grupo) */}
      <RecurrenceScopeDialog
        open={scopeFor !== null}
        onClose={() => { setScopeFor(null); setPendingRemove(null); setRenamingGroup(false); setGroupRenameValue(''); }}
        onChoose={(scope) => {
          if (scopeFor === 'add') addMut.mutate(scope);
          if (scopeFor === 'remove' && pendingRemove) removeMut.mutate({ child: pendingRemove, scope });
          if (scopeFor === 'rename') renameMut.mutate({ title: groupRenameValue, scope });
          if (scopeFor === 'due') dueMut.mutate(scope);
          if (scopeFor === 'delete') deleteGroupMut.mutate(scope);
          setScopeFor(null); setPendingRemove(null);
        }}
      />
    </AdaptiveSheet>
  );
}
