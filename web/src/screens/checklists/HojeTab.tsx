// Sprint 23 — HojeTab (Task 2.5 — implementação completa)

import { useState } from 'react';
import { useChecklistsHoje } from './hooks/useChecklistsHoje';
import type { WorkChecklistHoje, PersonalChecklistHoje } from './hooks/useChecklistsHoje';
import { ChecklistExecucaoDrawer } from './ChecklistExecucaoDrawer';

type Mode = 'work' | 'personal';

export function HojeTab() {
  const [mode, setMode] = useState<Mode>('work');
  const { data, isLoading } = useChecklistsHoje();
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading || !data) {
    return <div className="p-6 text-fg/40">Carregando…</div>;
  }

  const list = mode === 'work' ? data.work : data.personal;
  const workCount = data.work.length;
  const personalCount = data.personal.length;

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 px-6 py-4 overflow-y-auto">
        <div className="flex gap-2 mb-4">
          <Chip active={mode === 'work'} onClick={() => setMode('work')}>
            💼 Trabalho ({workCount})
          </Chip>
          <Chip active={mode === 'personal'} onClick={() => setMode('personal')}>
            🏡 Pessoal ({personalCount})
          </Chip>
        </div>

        {list.length === 0 ? (
          <EmptyList mode={mode} />
        ) : (
          <ul className="space-y-1">
            {list.map((c) => (
              <ChecklistRow
                key={`${c.scope}-${c.completion_id ?? c.checklist_id}`}
                checklist={c}
                selected={openId === (c.completion_id ?? c.checklist_id)}
                onClick={() => setOpenId(c.completion_id ?? c.checklist_id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="w-[480px] border-l border-border bg-bg-surface hidden lg:block overflow-y-auto">
        {(() => {
          if (!openId) {
            return (
              <div className="p-6 text-fg/40 text-sm">
                Selecione um checklist à esquerda pra executar
              </div>
            );
          }
          const selected = [...data.work, ...data.personal].find(
            (c) => (c.completion_id ?? c.checklist_id) === openId
          );
          if (!selected) {
            return (
              <div className="p-6 text-fg/40 text-sm">Checklist não encontrado.</div>
            );
          }
          return (
            <ChecklistExecucaoDrawer
              checklist={selected}
              onClose={() => setOpenId(null)}
            />
          );
        })()}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? 'bg-tom text-bg-app'
          : 'bg-bg-surface text-fg/70 hover:text-fg border border-border'
      }`}
    >
      {children}
    </button>
  );
}

function ChecklistRow({
  checklist,
  selected,
  onClick,
}: {
  checklist: WorkChecklistHoje | PersonalChecklistHoje;
  selected: boolean;
  onClick: () => void;
}) {
  const totalItems =
    checklist.items.length +
    (checklist.scope === 'work' ? checklist.extras.length : 0);
  const doneItems =
    checklist.items.filter((i) => i.is_checked).length +
    (checklist.scope === 'work'
      ? checklist.extras.filter((e) => e.is_checked).length
      : 0);
  const isComplete = !!checklist.completed_at;
  const time =
    checklist.scope === 'work'
      ? checklist.dispatch_time
        ? checklist.dispatch_time.slice(0, 5)
        : '—'
      : '—';

  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left border transition-colors ${
          selected
            ? 'bg-bg-surface border-tom/40'
            : 'border-transparent hover:bg-bg-surface hover:border-border'
        } ${isComplete ? 'opacity-60' : ''}`}
      >
        <div
          className={`w-4 h-4 rounded border-2 ${
            isComplete ? 'bg-tom border-tom' : 'border-fg/40'
          }`}
        />
        <span className="text-xs text-fg/60 w-12">{time}</span>
        <span className="flex-1 text-sm">{checklist.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-bg-app text-fg/60">
          {totalItems ? `${doneItems}/${totalItems}` : '0/0'}
        </span>
      </button>
    </li>
  );
}

function EmptyList({ mode }: { mode: Mode }) {
  return (
    <div className="text-fg/40 text-sm py-8 text-center">
      {mode === 'work'
        ? 'Sem checklists de trabalho hoje. Quando o TOM disparar algum, ele aparece aqui.'
        : 'Sem checklists pessoais hoje. Crie uma lista pra acompanhar suas rotinas.'}
    </div>
  );
}
