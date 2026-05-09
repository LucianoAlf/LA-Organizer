// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Aba de checkpoints: lista DnD de checkpoints + tasks dentro, view "por pessoa"
// (so canSeeAll), tasks orfas, criar checkpoint inline, criar task inline.
//
// Comportamento identico ao da implementacao inline anterior. Recebe dados +
// handlers do pai (ProjetoDetalhe) — nao consulta Supabase diretamente, exceto
// CreateTaskInline que tem o INSERT inline (mantido pra preservar comportamento).

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Check, ChevronDown, ChevronRight, GripVertical, Plus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSortableSensors } from '../lib/sortableSensors';
import { dragLiftStyle } from '../lib/sortableStyle';
import { brShort } from '../utils/date';
import { EmptyState } from '../components/EmptyState';
import { RowMenu } from '../components/RowMenu';
import { TaskListItem } from '../components/TaskListItem';
import { type AssigneeOption } from '../components/AssigneePicker';
import type { Task, ProjectMember } from '../types';
import type { CheckpointFull } from '../types/projectDetail';

interface CheckpointsTabProps {
  projectId: string;
  collaboratorId: string | null;
  canSeeAll: boolean;
  viewMode: 'by_checkpoint' | 'by_person';
  onViewModeChange: (mode: 'by_checkpoint' | 'by_person') => void;
  checkpoints: CheckpointFull[];
  tasks: Task[];
  members: ProjectMember[];
  tasksByCheckpoint: Map<string | null, Task[]>;
  orphanTasks: Task[];
  totalTaskCount: number;
  assigneeOptions: AssigneeOption[];
  togglePending: boolean;
  onToggleCheckpoint: (cp: CheckpointFull) => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (cpId: string, name: string) => void;
  onDeleteCheckpoint: (cpId: string) => void;
  onRenameTask: (tId: string, title: string) => void;
  onDeleteTask: (tId: string) => void;
  onAssignTask: (tId: string, cId: string) => void;
  onReorderCheckpoints: (orderedIds: string[]) => void;
  onReorderTasks: (cpId: string, orderedIds: string[]) => void;
  onCreateCheckpoint: (name: string) => void;
}

export function CheckpointsTab(props: CheckpointsTabProps) {
  const {
    projectId,
    collaboratorId,
    canSeeAll,
    viewMode,
    onViewModeChange,
    checkpoints,
    tasks,
    members,
    tasksByCheckpoint,
    orphanTasks,
    totalTaskCount,
    assigneeOptions,
    togglePending,
    onToggleCheckpoint,
    onToggleTask,
    onRenameCheckpoint,
    onDeleteCheckpoint,
    onRenameTask,
    onDeleteTask,
    onAssignTask,
    onReorderCheckpoints,
    onReorderTasks,
    onCreateCheckpoint,
  } = props;

  return (
    <section className="space-y-sm">
      {canSeeAll && (checkpoints.length > 0 || totalTaskCount > 0) && (
        <div className="flex items-center gap-1 text-body-sm" data-no-nav>
          <button
            type="button"
            onClick={() => onViewModeChange('by_checkpoint')}
            className={[
              'px-3 py-1.5 rounded-sm focus-ring transition-colors',
              viewMode === 'by_checkpoint' ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            Por checkpoint
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('by_person')}
            className={[
              'px-3 py-1.5 rounded-sm focus-ring transition-colors',
              viewMode === 'by_person' ? 'bg-bg-elevated text-fg' : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            Por pessoa
          </button>
        </div>
      )}
      {checkpoints.length === 0 && totalTaskCount === 0 ? (
        <div className="surface">
          <EmptyState
            title="Sem checkpoints ainda"
            description="Marcos do projeto. Peça pro TOM estruturar pelo WhatsApp ou crie manualmente quando o CRUD inline subir."
          />
        </div>
      ) : (
        <>
          {canSeeAll && viewMode === 'by_person' ? (
            <PeopleGroupedTasks
              members={members}
              tasks={tasks}
              checkpoints={checkpoints}
              onToggleTask={onToggleTask}
              onRenameTask={onRenameTask}
              onDeleteTask={onDeleteTask}
              onAssignTask={onAssignTask}
              assigneeOptions={assigneeOptions}
            />
          ) : (
            <CheckpointSortableList
              checkpoints={checkpoints}
              tasksByCheckpoint={tasksByCheckpoint}
              projectId={projectId}
              collaboratorId={collaboratorId}
              toggleDisabled={togglePending}
              onToggleCheckpoint={onToggleCheckpoint}
              onToggleTask={onToggleTask}
              onRenameCheckpoint={onRenameCheckpoint}
              onDeleteCheckpoint={onDeleteCheckpoint}
              onRenameTask={onRenameTask}
              onDeleteTask={onDeleteTask}
              onAssignTask={canSeeAll ? onAssignTask : undefined}
              assigneeOptions={assigneeOptions}
              showAssignee={canSeeAll}
              onReorderCheckpoints={onReorderCheckpoints}
              onReorderTasks={onReorderTasks}
            />
          )}
          {orphanTasks.length > 0 && (
            <div className="surface p-md">
              <div className="text-label text-fg-muted uppercase tracking-wide mb-2">
                Tarefas sem checkpoint
              </div>
              <ul className="divide-y divide-border">
                {orphanTasks.map(t => (
                  <TaskListItem
                    key={t.id}
                    task={t}
                    onToggle={() => onToggleTask(t)}
                    onRename={(title) => onRenameTask(t.id, title)}
                    onDelete={() => onDeleteTask(t.id)}
                    onAssign={canSeeAll ? onAssignTask : undefined}
                    assigneeOptions={assigneeOptions}
                    showAssignee={canSeeAll}
                  />
                ))}
              </ul>
            </div>
          )}
          <CreateCheckpointInline onCreate={onCreateCheckpoint} />
        </>
      )}
    </section>
  );
}

// ---- CheckpointCard --------------------------------------------------------
function CheckpointCard({
  checkpoint,
  tasks,
  onToggleCheckpoint,
  onToggleTask,
  onRenameCheckpoint,
  onDeleteCheckpoint,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
  showAssignee,
  onReorderTasks,
  toggleDisabled,
  projectId,
  collaboratorId,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: {
  checkpoint: CheckpointFull;
  tasks: Task[];
  onToggleCheckpoint: () => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (name: string) => void;
  onDeleteCheckpoint: () => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
  onReorderTasks: (orderedIds: string[]) => void;
  toggleDisabled: boolean;
  projectId: string;
  collaboratorId: string | null;
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const isDone = checkpoint.status === 'done';
  const [expanded, setExpanded] = useState(!isDone);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(checkpoint.name);
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== checkpoint.name) onRenameCheckpoint(v.slice(0, 200));
    setEditing(false);
  }

  return (
    <article
      ref={sortableRef}
      style={dragLiftStyle(isDragging, sortableStyle)}
      className="surface touch-none"
      {...(sortableAttributes ?? {})}
      {...(sortableListeners ?? {})}
    >
      {/* Header — visual de "marco/container". Padding maior, fundo do surface, checkbox quadrado grande. */}
      <div className="p-md flex items-start gap-md">
        {sortableListeners && (
          <span aria-hidden className="mt-1 text-fg-muted/40 cursor-grab">
            <GripVertical size={16} />
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCheckpoint}
          disabled={toggleDisabled}
          aria-label={isDone ? 'Reabrir checkpoint' : 'Marcar como feito'}
          className={[
            'mt-0.5 h-7 w-7 shrink-0 rounded-md border-2 grid place-items-center transition-colors focus-ring',
            isDone
              ? 'bg-tom border-tom text-white hover:bg-tom-shade'
              : 'bg-tom/10 border-tom/40 text-transparent hover:border-tom hover:bg-tom/20',
          ].join(' ')}
        >
          {isDone && <Check size={16} strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              autoFocus
              value={editValue}
              maxLength={200}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                if (e.key === 'Escape') { setEditValue(checkpoint.name); setEditing(false); }
              }}
              className="w-full h-9 px-2 -ml-2 rounded-md bg-bg-elevated border border-border text-card-title text-fg focus-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="w-full text-left focus-ring rounded-sm"
            >
              <div className={['text-card-title', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
                {checkpoint.name}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-body-sm text-fg-muted tabular-nums">
                {checkpoint.due_date && <span>{brShort(checkpoint.due_date)}</span>}
                {total > 0 && <span>· {done}/{total} {total === 1 ? 'tarefa' : 'tarefas'}</span>}
              </div>
              {/* Sprint 22.22n — barra de progresso interna do checkpoint */}
              {total > 0 && (
                <div className="mt-2 h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
                  <div
                    className={['h-full transition-[width]', isDone ? 'bg-tom' : 'bg-tom/70'].join(' ')}
                    style={{ width: `${Math.round((done / total) * 100)}%` }}
                  />
                </div>
              )}
            </button>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <RowMenu
            items={[
              { label: 'Editar nome', onClick: () => { setEditValue(checkpoint.name); setEditing(true); } },
              {
                label: 'Excluir checkpoint',
                danger: true,
                confirm: 'Excluir? Tarefas viram sem checkpoint.',
                onClick: () => onDeleteCheckpoint(),
              },
            ]}
          />
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Recolher' : 'Expandir'}
            className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>

      {/* Corpo — fundo levemente diferente + border-top pra dar separacao visual de container. */}
      {expanded && (
        <div className="space-y-3 bg-bg-subtle border-t border-border px-md pt-3 pb-md rounded-b-md">
          {checkpoint.rationale && (
            <div className="bg-tom/5 border-l-2 border-tom rounded-sm p-md text-body-sm text-fg-secondary">
              <div className="text-label text-tom mb-1">💡 POR QUE ESSE CHECKPOINT</div>
              <p className="whitespace-pre-line">{checkpoint.rationale}</p>
            </div>
          )}
          <div>
            <div className="text-label text-fg-muted uppercase tracking-wide mb-1">Tarefas</div>
            <div className="border-l-2 border-border pl-md">
              {tasks.length > 0 && (
                <SortableTaskList
                  tasks={tasks}
                  onReorder={onReorderTasks}
                  onToggleTask={onToggleTask}
                  onRenameTask={onRenameTask}
                  onDeleteTask={onDeleteTask}
                  onAssignTask={onAssignTask}
                  assigneeOptions={assigneeOptions}
                  showAssignee={showAssignee}
                />
              )}
              <div className={tasks.length > 0 ? 'pt-2' : ''}>
                <CreateTaskInline
                  projectId={projectId}
                  checkpointId={checkpoint.id}
                  collaboratorId={collaboratorId}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// ---- CreateTaskInline ------------------------------------------------------
function CreateTaskInline({
  projectId,
  checkpointId,
  collaboratorId,
}: {
  projectId: string;
  checkpointId: string;
  collaboratorId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const qc = useQueryClient();
  const createTask = useMutation({
    mutationFn: async () => {
      if (!collaboratorId) throw new Error('no_auth');
      const t = title.trim();
      if (!t) return;
      const { error } = await supabase.from('tasks').insert({
        title: t.slice(0, 200),
        project_id: projectId,
        checkpoint_id: checkpointId,
        assigned_to: collaboratorId,
        created_by: collaboratorId,
        source: 'manual',
        status: 'pending',
        context: 'work',
        priority: 'medium',
        action_type: 'task',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['project', projectId, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) createTask.mutate();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      setTitle('');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-tom focus-ring rounded-sm px-1 py-0.5"
      >
        <Plus size={14} /> Tarefa
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="text"
        autoFocus
        value={title}
        maxLength={200}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="O que precisa fazer..."
        className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setTitle(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!title.trim() || createTask.isPending}
          className="h-9 px-3 rounded-md bg-tom text-black text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Salvar
        </button>
      </div>
      {createTask.error && (
        <p className="text-body-sm text-danger" role="alert">
          Não consegui salvar: {(createTask.error as Error).message}
        </p>
      )}
    </form>
  );
}

// ---- Sortable wrappers (DnD) -----------------------------------------------
function CheckpointSortableList({
  checkpoints,
  tasksByCheckpoint,
  projectId,
  collaboratorId,
  toggleDisabled,
  onToggleCheckpoint,
  onToggleTask,
  onRenameCheckpoint,
  onDeleteCheckpoint,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
  showAssignee,
  onReorderCheckpoints,
  onReorderTasks,
}: {
  checkpoints: CheckpointFull[];
  tasksByCheckpoint: Map<string | null, Task[]>;
  projectId: string;
  collaboratorId: string | null;
  toggleDisabled: boolean;
  onToggleCheckpoint: (cp: CheckpointFull) => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (cpId: string, name: string) => void;
  onDeleteCheckpoint: (cpId: string) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
  onReorderCheckpoints: (orderedIds: string[]) => void;
  onReorderTasks: (checkpointId: string, orderedIds: string[]) => void;
}) {
  const sensors = useSortableSensors();
  const ids = checkpoints.map(c => c.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorderCheckpoints(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-sm">
          {checkpoints.map(cp => (
            <SortableCheckpointWrapper
              key={cp.id}
              checkpoint={cp}
              tasks={tasksByCheckpoint.get(cp.id) ?? []}
              projectId={projectId}
              collaboratorId={collaboratorId}
              toggleDisabled={toggleDisabled}
              onToggleCheckpoint={() => onToggleCheckpoint(cp)}
              onToggleTask={onToggleTask}
              onRenameCheckpoint={(name) => onRenameCheckpoint(cp.id, name)}
              onDeleteCheckpoint={() => onDeleteCheckpoint(cp.id)}
              onRenameTask={onRenameTask}
              onDeleteTask={onDeleteTask}
              onAssignTask={onAssignTask}
              assigneeOptions={assigneeOptions}
              showAssignee={showAssignee}
              onReorderTasks={(ids) => onReorderTasks(cp.id, ids)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableCheckpointWrapper(props: {
  checkpoint: CheckpointFull;
  tasks: Task[];
  projectId: string;
  collaboratorId: string | null;
  toggleDisabled: boolean;
  onToggleCheckpoint: () => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (name: string) => void;
  onDeleteCheckpoint: () => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
  onReorderTasks: (orderedIds: string[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.checkpoint.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <CheckpointCard
      {...props}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}

function SortableTaskList({
  tasks,
  onReorder,
  onToggleTask,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
  showAssignee,
}: {
  tasks: Task[];
  onReorder: (orderedIds: string[]) => void;
  onToggleTask: (t: Task) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
}) {
  const sensors = useSortableSensors();
  const ids = tasks.map(t => t.id);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-border">
          {tasks.map((t, i) => (
            <SortableTaskItem
              key={t.id}
              task={t}
              index={i}
              onToggle={() => onToggleTask(t)}
              onRename={(title) => onRenameTask(t.id, title)}
              onDelete={() => onDeleteTask(t.id)}
              onAssign={onAssignTask}
              assigneeOptions={assigneeOptions}
              showAssignee={showAssignee}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableTaskItem(props: {
  task: Task;
  index: number;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onAssign?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  showAssignee?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <TaskListItem
      task={props.task}
      index={props.index}
      onToggle={props.onToggle}
      onRename={props.onRename}
      onDelete={props.onDelete}
      onAssign={props.onAssign}
      assigneeOptions={props.assigneeOptions}
      showAssignee={props.showAssignee}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}

// ---- CreateCheckpointInline ------------------------------------------------
function CreateCheckpointInline({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function commit(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    onCreate(v);
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface w-full p-md flex items-center gap-2 text-body-md text-fg-muted hover:text-tom hover:border-tom/40 transition-colors focus-ring"
      >
        <Plus size={16} /> Adicionar checkpoint
      </button>
    );
  }

  return (
    <form onSubmit={commit} className="surface p-md space-y-2">
      <div className="text-label text-fg-muted uppercase tracking-wide">Novo checkpoint</div>
      <input
        type="text"
        autoFocus
        value={name}
        maxLength={200}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setName(''); } }}
        placeholder="Ex: Reservar local"
        className="w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setName(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="h-9 px-3 rounded-md bg-tom text-black text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Criar
        </button>
      </div>
    </form>
  );
}

// ---- PeopleGroupedTasks — visao "Por pessoa" (so canSeeAll usa) ------------
// Agrupa as tasks por assigned_to, mostrando cada pessoa como um header com
// suas tasks dentro. Membros sem tarefas tambem aparecem (estado vazio).
function PeopleGroupedTasks({
  members,
  tasks,
  checkpoints,
  onToggleTask,
  onRenameTask,
  onDeleteTask,
  onAssignTask,
  assigneeOptions,
}: {
  members: ProjectMember[];
  tasks: Task[];
  checkpoints: CheckpointFull[];
  onToggleTask: (t: Task) => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  onAssignTask: (taskId: string, collabId: string) => void;
  assigneeOptions: AssigneeOption[];
}) {
  // Agrupa tasks por assigned_to. Tasks sem assigned vao pra "Sem atribuicao".
  const byPerson = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = t.assigned_to ?? '__none__';
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push(t);
  }

  // Lista de "buckets": membros internos primeiro (ordem do cadastro), depois "sem atribuicao" se houver.
  const internalMembers = members.filter(m => m.collaborator_id);
  const buckets: Array<{ key: string; name: string; subtitle?: string; tasks: Task[]; isUnassigned?: boolean }> = [];
  for (const m of internalMembers) {
    buckets.push({
      key: m.collaborator_id!,
      name: m.collaborator?.full_name ?? '—',
      subtitle: m.role_in_project,
      tasks: byPerson.get(m.collaborator_id!) ?? [],
    });
  }
  const unassigned = byPerson.get('__none__') ?? [];
  if (unassigned.length > 0) {
    buckets.push({ key: '__none__', name: 'Sem atribuição', tasks: unassigned, isUnassigned: true });
  }

  // Map de checkpoint_id -> nome pra mostrar no contexto da task
  const cpName = new Map(checkpoints.map(c => [c.id, c.name] as const));

  return (
    <div className="space-y-sm">
      {buckets.map(b => {
        const done = b.tasks.filter(t => t.status === 'done').length;
        return (
          <article key={b.key} className="surface">
            <div className="p-md flex items-center justify-between gap-md border-b border-border">
              <div className="min-w-0">
                <div className="text-card-title flex items-center gap-2">
                  <span className="truncate">{b.name}</span>
                  {b.subtitle && (
                    <span className="text-[11px] font-medium text-fg-muted bg-bg-elevated rounded-sm px-1.5 py-0.5 border border-border shrink-0">
                      {b.subtitle}
                    </span>
                  )}
                </div>
                <div className="text-body-sm text-fg-muted tabular-nums mt-0.5">
                  {b.tasks.length === 0 ? 'sem tarefas' : `${done}/${b.tasks.length} ${b.tasks.length === 1 ? 'tarefa' : 'tarefas'}`}
                </div>
              </div>
            </div>
            {b.tasks.length > 0 && (
              <ul className="divide-y divide-border px-md">
                {b.tasks.map(t => (
                  <TaskListItem
                    key={t.id}
                    task={t}
                    onToggle={() => onToggleTask(t)}
                    onRename={(title) => onRenameTask(t.id, title)}
                    onDelete={() => onDeleteTask(t.id)}
                    onAssign={(taskId, collabId) => onAssignTask(taskId, collabId)}
                    assigneeOptions={assigneeOptions}
                    showAssignee
                  />
                ))}
                {/* Hint de quantos checkpoints a pessoa cobre */}
                {(() => {
                  const cpIds = new Set(b.tasks.map(t => (t as Task & { checkpoint_id?: string | null }).checkpoint_id).filter(Boolean));
                  if (cpIds.size === 0) return null;
                  return (
                    <li className="py-2 text-[11px] text-fg-muted/60 italic">
                      {cpIds.size === 1 ? `1 checkpoint envolvido` : `${cpIds.size} checkpoints envolvidos`}
                      {cpIds.size <= 3 && (
                        <span> · {Array.from(cpIds).map(cid => cpName.get(cid as string) || '').filter(Boolean).join(', ')}</span>
                      )}
                    </li>
                  );
                })()}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
