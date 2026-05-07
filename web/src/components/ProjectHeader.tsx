// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Header do projeto com tap-to-edit nome/descricao/event_date e menu (...).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CategoryTag } from './CategoryTag';
import { RowMenu } from './RowMenu';
import { PROJECT_CATEGORY_LABELS } from '../lib/projectLabels';
import { brShort } from '../utils/date';
import type { ProjectFull } from '../types/projectDetail';

export function ProjectHeader({
  project,
  pct,
  onRename,
  onUpdateDescription,
  onUpdateEventDate,
  onUpdateCategory,
  onDelete,
}: {
  project: ProjectFull;
  pct: number;
  onRename: (name: string) => void;
  onUpdateDescription: (description: string) => void;
  onUpdateEventDate: (eventDate: string) => void;
  onUpdateCategory: (category: ProjectFull['category']) => void;
  onDelete: () => void;
}) {
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState(project.name);
  const [editDesc, setEditDesc] = useState(false);
  const [descVal, setDescVal] = useState(project.description ?? '');
  const [editDate, setEditDate] = useState(false);
  const [dateVal, setDateVal] = useState(project.event_date ?? '');

  function commitName() {
    const v = nameVal.trim();
    if (v && v !== project.name) onRename(v.slice(0, 200));
    setEditName(false);
  }
  function commitDesc() {
    const v = descVal.trim();
    if (v !== (project.description ?? '')) onUpdateDescription(v.slice(0, 1000));
    setEditDesc(false);
  }
  function commitDate() {
    if (dateVal !== (project.event_date ?? '')) onUpdateEventDate(dateVal);
    setEditDate(false);
  }

  return (
    <header>
      <Link to="/projetos" className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-fg focus-ring">
        <ArrowLeft size={16} /> Projetos
      </Link>
      <div className="mt-md flex items-start gap-md justify-between flex-wrap">
        <div className="min-w-0 flex-1">
          {editName ? (
            <input
              type="text"
              autoFocus
              value={nameVal}
              maxLength={200}
              onChange={e => setNameVal(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitName(); }
                if (e.key === 'Escape') { setNameVal(project.name); setEditName(false); }
              }}
              className="w-full h-12 px-2 -ml-2 rounded-md bg-bg-elevated border border-border text-screen-title text-fg focus-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setNameVal(project.name); setEditName(true); }}
              className="text-screen-title text-left hover:text-tom transition-colors focus-ring rounded-sm"
            >
              {project.name}
            </button>
          )}

          {editDesc ? (
            <textarea
              autoFocus
              value={descVal}
              maxLength={1000}
              onChange={e => setDescVal(e.target.value)}
              onBlur={commitDesc}
              onKeyDown={e => {
                if (e.key === 'Escape') { setDescVal(project.description ?? ''); setEditDesc(false); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitDesc(); }
              }}
              rows={3}
              className="w-full mt-1 px-2 py-1.5 -ml-2 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring resize-none"
              placeholder="Descrição do projeto"
            />
          ) : project.description ? (
            <button
              type="button"
              onClick={() => { setDescVal(project.description ?? ''); setEditDesc(true); }}
              className="text-body-md text-fg-muted mt-1 max-w-prose text-left hover:text-fg transition-colors focus-ring rounded-sm"
            >
              {project.description}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setDescVal(''); setEditDesc(true); }}
              className="text-body-sm text-fg-muted/60 mt-1 italic hover:text-fg-muted transition-colors focus-ring rounded-sm"
            >
              + descrição
            </button>
          )}

          {editDate ? (
            <input
              type="date"
              autoFocus
              value={dateVal}
              onChange={e => setDateVal(e.target.value)}
              onBlur={commitDate}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitDate(); }
                if (e.key === 'Escape') { setDateVal(project.event_date ?? ''); setEditDate(false); }
              }}
              className="mt-1 h-9 px-2 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring tabular-nums"
            />
          ) : project.event_date ? (
            <button
              type="button"
              onClick={() => { setDateVal(project.event_date ?? ''); setEditDate(true); }}
              className="text-body-sm text-fg-muted mt-1 hover:text-fg transition-colors focus-ring rounded-sm"
            >
              <span aria-hidden>🎯</span>{' '}
              Evento: <span className="text-fg tabular-nums">{brShort(project.event_date)}</span>
            </button>
          ) : project.category === 'event' ? (
            <button
              type="button"
              onClick={() => { setDateVal(''); setEditDate(true); }}
              className="block text-body-sm text-fg-muted/60 mt-1 italic hover:text-fg-muted transition-colors focus-ring rounded-sm"
            >
              + data do evento
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CategoryTag
            project={project}
            label={PROJECT_CATEGORY_LABELS[project.category]}
            onChange={onUpdateCategory}
          />
          <RowMenu
            items={[
              {
                label: 'Excluir projeto',
                danger: true,
                confirm: 'Excluir esse projeto? Tarefas viram orfas. Essa acao nao pode ser desfeita.',
                onClick: onDelete,
              },
            ]}
          />
        </div>
      </div>

      <div className="mt-md">
        <div className="flex items-center justify-between text-body-sm text-fg-muted mb-1.5 tabular-nums">
          <span>Progresso</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-tom transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </header>
  );
}
