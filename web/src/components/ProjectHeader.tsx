// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Header do projeto com tap-to-edit nome/descricao/event_date e menu (...).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Crown, Users } from 'lucide-react';
import { CategoryTag } from './CategoryTag';
import { DateInput } from './DateInput';
import { RowMenu } from './RowMenu';
import { PROJECT_CATEGORY_LABELS } from '../lib/projectLabels';
import { brShort } from '../utils/date';
import type { ProjectFull } from '../types/projectDetail';
import type { ProjectMember } from '../types';

export function ProjectHeader({
  project,
  pct,
  members,
  onRename,
  onUpdateDescription,
  onUpdateEventDate,
  onUpdateStartDate,
  onUpdateEndDate,
  onUpdateCategory,
  onDelete,
}: {
  project: ProjectFull;
  pct: number;
  members?: ProjectMember[];
  onRename: (name: string) => void;
  onUpdateDescription: (description: string) => void;
  onUpdateEventDate: (eventDate: string) => void;
  onUpdateStartDate: (date: string) => void;
  onUpdateEndDate: (date: string) => void;
  onUpdateCategory: (category: ProjectFull['category']) => void;
  onDelete: () => void;
}) {
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState(project.name);
  const [editDesc, setEditDesc] = useState(false);
  const [descVal, setDescVal] = useState(project.description ?? '');
  const [editDate, setEditDate] = useState(false);
  const [dateVal, setDateVal] = useState(project.event_date ?? '');
  const [editStartDate, setEditStartDate] = useState(false);
  const [editEndDate, setEditEndDate] = useState(false);

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

  // Sprint — linha "Responsável: X · Time: Y, Z (+N)" logo abaixo do nome.
  // Owner (created_by) ganha destaque; resto vira lista enxuta com truncamento.
  const internalMembers = (members ?? []).filter(m => m.collaborator?.full_name);
  const ownerMember = internalMembers.find(m => m.collaborator_id === project.created_by)
    ?? internalMembers.find(m => m.role_in_project === 'owner')
    ?? internalMembers.find(m => m.role_in_project === 'coordinator');
  const ownerName = ownerMember?.collaborator?.full_name ?? null;
  const otherMembers = internalMembers.filter(m => m !== ownerMember);
  const otherFirstNames = otherMembers
    .map(m => (m.collaborator?.full_name ?? '').split(' ')[0])
    .filter(Boolean);
  const visibleOthers = otherFirstNames.slice(0, 4);
  const extraOthers = Math.max(0, otherFirstNames.length - visibleOthers.length);

  // Detecta description "lixo" gerada pelo wizard antigo (memberNames.join(', ')).
  // Se a description for so uma lista de nomes que batem com os membros, suprime
  // a renderizacao — a linha de Responsavel/Time ja mostra essa informacao.
  const descRaw = (project.description ?? '').trim();
  const memberFullNames = internalMembers.map(m => (m.collaborator?.full_name ?? '').trim()).filter(Boolean);
  const memberFirstNames = memberFullNames.map(n => n.split(' ')[0]);
  const descTokens = descRaw.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
  const isMemberListDesc = descTokens.length > 0
    && descTokens.every(tok => memberFullNames.includes(tok) || memberFirstNames.includes(tok));
  const showDescription = descRaw.length > 0 && !isMemberListDesc;

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

          {(ownerName || visibleOthers.length > 0) && (
            <div className="mt-1 text-body-sm text-fg-muted flex flex-wrap items-center gap-x-2 gap-y-1">
              {ownerName && (
                <span className="inline-flex items-center gap-1 text-tom font-medium">
                  <Crown size={12} />
                  Responsável: <span className="text-fg">{ownerName}</span>
                </span>
              )}
              {visibleOthers.length > 0 && (
                <>
                  {ownerName && <span className="text-fg-muted/40">·</span>}
                  <span className="inline-flex items-center gap-1">
                    <Users size={12} className="opacity-70" />
                    Time: {visibleOthers.join(', ')}
                    {extraOthers > 0 && ` +${extraOthers}`}
                  </span>
                </>
              )}
            </div>
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
          ) : showDescription ? (
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

          {/* Datas de início e fim do projeto */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
            {/* Início */}
            <div className="flex items-center gap-1.5 text-body-sm text-fg-muted">
              <span className="text-fg-muted/60">Início:</span>
              {editStartDate ? (
                <DateInput
                  value={project.start_date ?? ''}
                  onChange={(date) => {
                    if (date !== (project.start_date ?? '')) onUpdateStartDate(date);
                    setEditStartDate(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditStartDate(true)}
                  className="text-fg hover:text-tom transition-colors focus-ring rounded-sm tabular-nums"
                >
                  {project.start_date
                    ? brShort(project.start_date)
                    : <span className="italic text-fg-muted/60">+ início</span>
                  }
                </button>
              )}
            </div>
            {/* Fim */}
            <div className="flex items-center gap-1.5 text-body-sm text-fg-muted">
              <span className="text-fg-muted/60">Fim:</span>
              {editEndDate ? (
                <DateInput
                  value={project.end_date ?? ''}
                  onChange={(date) => {
                    if (date !== (project.end_date ?? '')) onUpdateEndDate(date);
                    setEditEndDate(false);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditEndDate(true)}
                  className="text-fg hover:text-tom transition-colors focus-ring rounded-sm tabular-nums"
                >
                  {project.end_date
                    ? brShort(project.end_date)
                    : <span className="italic text-fg-muted/60">+ fim</span>
                  }
                </button>
              )}
            </div>
          </div>
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
