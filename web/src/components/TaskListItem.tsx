// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Item de tarefa com toggle, edicao inline, atraso (overdue) e atribuicao.
// Comportamento identico ao da versao inline anterior.

import { useState } from 'react';
import { Check, GripVertical } from 'lucide-react';
import { AssigneePicker, type AssigneeOption } from './AssigneePicker';
import { RowMenu } from './RowMenu';
import { dragLiftStyle } from '../lib/sortableStyle';
import { brShort } from '../utils/date';
import { daysOverdue, todaySP } from '../utils/overdue';
import type { Task } from '../types';

export function TaskListItem({
  task,
  index,
  onToggle,
  onRename,
  onDelete,
  onAssign,
  assigneeOptions,
  showAssignee,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: {
  task: Task;
  /** Posicao na lista (0-based). Mostrado como "{index+1}." na frente do titulo. */
  index?: number;
  onToggle: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
  /** Quando passado + showAssignee, exibe AssigneePicker. */
  onAssign?: (taskId: string, collabId: string) => void;
  assigneeOptions?: AssigneeOption[];
  /** True quando o user atual eh owner/coord do projeto (ve assignees + edita). */
  showAssignee?: boolean;
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const isDone = task.status === 'done';
  // Sprint 22.22i — atrasada quando due_date < hoje SP e nao concluida.
  const isOverdue = !isDone && !!task.due_date && task.due_date < todaySP();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== task.title && onRename) onRename(v.slice(0, 200));
    setEditing(false);
  }

  return (
    <li
      ref={sortableRef as ((node: HTMLLIElement | null) => void) | undefined}
      style={dragLiftStyle(isDragging, sortableStyle)}
      className="py-2 flex items-start gap-2 group"
      {...(sortableAttributes ?? {})}
    >
      {sortableListeners && (
        <span aria-hidden className="mt-1 text-fg-muted/40 cursor-grab" style={{ touchAction: 'none' }}
          {...sortableListeners}>
          <GripVertical size={14} />
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-label={isDone ? 'Reabrir tarefa' : 'Concluir tarefa'}
        className={[
          'mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 grid place-items-center transition-colors focus-ring',
          isDone
            ? 'bg-tom border-tom text-black'
            : isOverdue
              ? 'border-danger text-transparent hover:border-danger animate-pulse'
              : 'border-fg-muted text-transparent hover:border-tom',
        ].join(' ')}
      >
        {isDone && <Check size={12} strokeWidth={3} />}
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
              if (e.key === 'Escape') { setEditValue(task.title); setEditing(false); }
            }}
            className="w-full h-8 px-2 -ml-2 rounded-sm bg-bg-elevated border border-border text-body-md text-fg focus-ring"
          />
        ) : (
          <div className={['text-body-md', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
            {typeof index === 'number' && (
              <span className="text-fg-muted tabular-nums mr-1.5">{index + 1}.</span>
            )}
            {task.title}
          </div>
        )}
        {task.due_date && !editing && (
          <div className={['text-body-sm tabular-nums mt-0.5 inline-flex items-center gap-1', isOverdue ? 'text-danger font-medium' : 'text-fg-muted'].join(' ')}>
            {isOverdue && <span aria-hidden>⚠️</span>}
            <span>{brShort(task.due_date)}</span>
            {isOverdue && (
              <span className="ml-1">
                · atrasada {daysOverdue(task.due_date)}d
              </span>
            )}
          </div>
        )}
      </div>
      {showAssignee && onAssign && !editing && (
        <AssigneePicker
          value={task.assigned_to}
          options={assigneeOptions ?? []}
          onChange={(collabId) => onAssign(task.id, collabId)}
        />
      )}
      {(onRename || onDelete) && !editing && (
        <RowMenu
          items={[
            ...(onRename ? [{ label: 'Editar', onClick: () => { setEditValue(task.title); setEditing(true); } }] : []),
            ...(onDelete ? [{ label: 'Excluir tarefa', danger: true, confirm: 'Excluir essa tarefa?', onClick: () => onDelete() }] : []),
          ]}
        />
      )}
    </li>
  );
}
