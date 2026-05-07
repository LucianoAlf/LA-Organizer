// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Aba de contingencias: lista DnD com cenario + plano B, criar/editar/excluir inline.

import { useState, type FormEvent } from 'react';
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
import { AlertTriangle, GripVertical, Plus } from 'lucide-react';
import { useSortableSensors } from '../lib/sortableSensors';
import { EmptyState } from '../components/EmptyState';
import { RowMenu } from '../components/RowMenu';
import type { Contingency } from '../types/projectDetail';

interface ContingenciasTabProps {
  contingencies: Contingency[];
  onCreate: (scenario: string, protocol: string) => void;
  onUpdate: (ctId: string, scenario: string, protocol: string) => void;
  onDelete: (ctId: string) => void;
  onReorder: (orderedIds: string[]) => void;
}

export function ContingenciasTab({
  contingencies,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
}: ContingenciasTabProps) {
  return (
    <section className="space-y-sm">
      {contingencies.length === 0 ? (
        <div className="surface p-md">
          <EmptyState
            icon={<AlertTriangle size={32} />}
            title="Sem cenários de contingência"
            description='Defina antes "se X acontecer → faça Y". O TOM cria pelo WhatsApp quando você pede pra mapear riscos do projeto.'
          />
        </div>
      ) : (
        <SortableContingencyList
          contingencies={contingencies}
          onReorder={onReorder}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      )}
      <CreateContingencyInline onCreate={onCreate} />
    </section>
  );
}

// ---- SortableContingencyList — lista DnD de contingencias ------------------
function SortableContingencyList({
  contingencies,
  onReorder,
  onUpdate,
  onDelete,
}: {
  contingencies: Contingency[];
  onReorder: (orderedIds: string[]) => void;
  onUpdate: (ctId: string, scenario: string, protocol: string) => void;
  onDelete: (ctId: string) => void;
}) {
  const sensors = useSortableSensors();
  const ids = contingencies.map(c => c.id);

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
        <ul className="space-y-sm">
          {contingencies.map(ct => (
            <SortableContingencyCard
              key={ct.id}
              contingency={ct}
              onUpdate={(scenario, protocol) => onUpdate(ct.id, scenario, protocol)}
              onDelete={() => onDelete(ct.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableContingencyCard(props: {
  contingency: Contingency;
  onUpdate: (scenario: string, protocol: string) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.contingency.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <ContingencyCard
      {...props}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={listeners}
      isDragging={isDragging}
    />
  );
}

// ---- ContingencyCard — card editavel com menu (...) ------------------------
function ContingencyCard({
  contingency,
  onUpdate,
  onDelete,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: {
  contingency: Contingency;
  onUpdate: (scenario: string, protocol: string) => void;
  onDelete: () => void;
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [scenarioVal, setScenarioVal] = useState(contingency.scenario);
  const [protocolVal, setProtocolVal] = useState(contingency.protocol);

  function commit() {
    const s = scenarioVal.trim();
    const p = protocolVal.trim();
    if (!s || !p) { setEditing(false); return; }
    if (s !== contingency.scenario || p !== contingency.protocol) onUpdate(s, p);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="surface p-md space-y-2">
        <div className="text-label text-fg-muted uppercase tracking-wide">Editar cenário</div>
        <input
          type="text"
          autoFocus
          value={scenarioVal}
          maxLength={500}
          onChange={e => setScenarioVal(e.target.value)}
          placeholder='Ex: "Se chuva cancelar"'
          className="w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring"
        />
        <textarea
          value={protocolVal}
          maxLength={2000}
          onChange={e => setProtocolVal(e.target.value)}
          rows={3}
          placeholder="Protocolo: o que fazer"
          className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring resize-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setScenarioVal(contingency.scenario);
              setProtocolVal(contingency.protocol);
              setEditing(false);
            }}
            className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={!scenarioVal.trim() || !protocolVal.trim()}
            className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
          >
            Salvar
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      ref={sortableRef as ((node: HTMLLIElement | null) => void) | undefined}
      style={{ ...sortableStyle, opacity: isDragging ? 0.5 : undefined, zIndex: isDragging ? 20 : undefined }}
      className="surface p-md border-l-4 border-l-danger/70 touch-none"
      {...(sortableAttributes ?? {})}
      {...(sortableListeners ?? {})}
    >
      <div className="flex items-start gap-2">
        {sortableListeners && (
          <span aria-hidden className="mt-1 text-fg-muted/40 cursor-grab shrink-0">
            <GripVertical size={14} />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-label text-danger uppercase tracking-wide mb-1">⚠️ Cenário</div>
            <div className="text-body-md font-semibold text-fg">{contingency.scenario}</div>
          </div>
          <div className="pt-2 border-t border-border/50">
            <div className="text-label text-fg-muted uppercase tracking-wide mb-1">Plano B</div>
            <p className="text-body-sm text-fg-secondary whitespace-pre-line">{contingency.protocol}</p>
          </div>
        </div>
        <RowMenu
          items={[
            { label: 'Editar', onClick: () => setEditing(true) },
            { label: 'Excluir', danger: true, confirm: 'Excluir esse cenário?', onClick: onDelete },
          ]}
        />
      </div>
    </li>
  );
}

// ---- CreateContingencyInline -----------------------------------------------
function CreateContingencyInline({
  onCreate,
}: {
  onCreate: (scenario: string, protocol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState('');
  const [protocol, setProtocol] = useState('');

  function commit(e: FormEvent) {
    e.preventDefault();
    const s = scenario.trim();
    const p = protocol.trim();
    if (!s || !p) return;
    onCreate(s, p);
    setScenario('');
    setProtocol('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface w-full p-md flex items-center gap-2 text-body-md text-fg-muted hover:text-tom hover:border-tom/40 transition-colors focus-ring"
      >
        <Plus size={16} /> Adicionar contingência
      </button>
    );
  }

  return (
    <form onSubmit={commit} className="surface p-md space-y-2">
      <div className="text-label text-fg-muted uppercase tracking-wide">Novo cenário</div>
      <input
        type="text"
        autoFocus
        value={scenario}
        maxLength={500}
        onChange={e => setScenario(e.target.value)}
        placeholder='Ex: "Se chuva cancelar"'
        className="w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <textarea
        value={protocol}
        maxLength={2000}
        onChange={e => setProtocol(e.target.value)}
        rows={3}
        placeholder="Protocolo: o que fazer se acontecer"
        className="w-full px-3 py-2 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setScenario(''); setProtocol(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!scenario.trim() || !protocol.trim()}
          className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Criar
        </button>
      </div>
    </form>
  );
}
