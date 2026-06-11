// GroupRow — linha expansível do grupo no painel da Agenda (tela aprovada).
// Grupos de tarefas (2026-06-09): densidade igual ao CompactTaskRow.
import { useState } from 'react';
import type { TaskForPanel } from '../../hooks/useAgendaTasks';

interface Props {
  group: TaskForPanel & { subtasks?: TaskForPanel[] };
  dayYmd: string;
  onToggleChild: (child: TaskForPanel, done: boolean) => void;
  onOpen: () => void;
}

export function GroupRow({ group, dayYmd, onToggleChild, onOpen }: Props) {
  const [expanded, setExpanded] = useState(true);
  const kids = (group.subtasks ?? []);
  const total = kids.length;
  const done = kids.filter(k => k.status === 'done').length;
  const dayKids = kids.filter(k => k.status !== 'done' && k.due_date && k.due_date <= dayYmd);
  return (
    <div className="px-1 py-0.5">
      <div className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-bg-elevated min-w-0">
        <button type="button" onClick={() => setExpanded(v => !v)} className="text-fg-muted text-[10px] w-3">
          {expanded ? '▼' : '▸'}
        </button>
        <button type="button" onClick={onOpen} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
          <span aria-hidden>🗂️</span>
          <span className="text-[12px] font-semibold truncate">{group.title}</span>
          {group.work_group_name && (
            <span className="text-[10px] text-tom shrink-0" title={`Grupo de trabalho ${group.work_group_name} — qualquer membro pode concluir`}>
              👥 {group.work_group_name}
            </span>
          )}
        </button>
        <span className="w-12 h-[3px] bg-bg-elevated rounded-full overflow-hidden shrink-0">
          <span className="block h-full bg-tom" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
        </span>
        <span className="text-[10px] text-fg-muted tabular-nums shrink-0">{done}/{total}</span>
      </div>
      {expanded && dayKids.map(k => (
        <div key={k.id} className="ml-5 border-l border-border pl-2 flex items-center gap-2 px-1 py-0.5 rounded hover:bg-bg-elevated">
          <button
            type="button"
            aria-label="Concluir"
            onClick={() => onToggleChild(k, true)}
            className="h-3 w-3 rounded-full border-2 border-fg-muted hover:border-tom shrink-0"
          />
          <span className="text-[12px] truncate flex-1">{k.title}</span>
          <span className="text-[10px] text-fg-muted shrink-0">
            {k.due_time ? `🕐 ${k.due_time.slice(0, 5)}` : (k.due_date === dayYmd ? 'hoje' : '')}
          </span>
        </div>
      ))}
    </div>
  );
}
