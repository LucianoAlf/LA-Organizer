// web/src/screens/grupos/GrupoAnotacoes.tsx
// Base de conhecimento do grupo (v2) — módulo de tela cheia: fichas tipadas (campos
// rótulo:valor + copiar), lista + detalhe. Rota /grupos/:groupId/anotacoes.
import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Plus, Search, NotebookText, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, useMyGroupIds } from '../../hooks/useWorkGroups';
import { useGroupNotes } from '../../hooks/useGroupNotes';
import { useGroupNoteTypes } from '../../hooks/useGroupNoteTypes';
import { useSortableSensors } from '../../lib/sortableSensors';
import { filterNotes, renumber, templateFor, buildTypeIndex, notesWithSecrets, type GroupNote, type TypeIndex } from '../../lib/groupNotes';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { showToast } from '../../components/Toast';
import { NotesSummary } from './notes/NotesSummary';
import { NotesTypeFilter } from './notes/NotesTypeFilter';
import { NoteCard } from './notes/NoteCard';
import { NoteDetail } from './notes/NoteDetail';
import { NoteEditor } from './notes/NoteEditor';

const first = (name: string | null | undefined) => (name ?? '').split(' ')[0];

function blankNote(groupId: string): GroupNote {
  return { id: '', group_id: groupId, type: 'acesso', category: 'Geral', tags: [], title: '', body: '', fields: templateFor('acesso'), pinned: false, sort_order: 0, color: null, icon: null, created_by: null, updated_by: null, created_at: '', updated_at: '' };
}

// Card arrastável: grip = activator (handle-only); o card abre no clique normal.
function SortableNoteCard({ note, active, onClick, idx }: { note: GroupNote; active: boolean; onClick: () => void; idx?: TypeIndex }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, zIndex: isDragging ? 20 : undefined, position: 'relative' };
  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-1">
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Arrastar pra reordenar"
        className="shrink-0 px-0.5 grid place-items-center text-fg-muted hover:text-fg cursor-grab touch-none focus-ring rounded-sm">
        <GripVertical size={16} />
      </button>
      <div className="flex-1 min-w-0"><NoteCard note={note} active={active} onClick={onClick} idx={idx} /></div>
    </div>
  );
}

const sectionLabel = 'text-caption uppercase tracking-wide text-fg-muted px-xs pt-xs pb-[2px]';

export function GrupoAnotacoes() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { list, meuId } = useWorkGroups();
  const myIds = useMyGroupIds();
  const { notes, loading, save, remove, pin, reorder } = useGroupNotes(groupId || '');
  const { types } = useGroupNoteTypes(groupId || '');
  const typeIndex = useMemo(() => buildTypeIndex(types), [types]);
  const sensors = useSortableSensors();

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [secretsOnly, setSecretsOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GroupNote | null>(null);
  const [editing, setEditing] = useState(false);
  const [pane, setPane] = useState<'list' | 'doc'>('list');
  // key do editor: muda a cada abertura (nova/existente) → remonta limpo (evita draft preso
  // do React reusar a instância). NÃO muda quando uma ficha nova ganha id (sem remount ao digitar).
  const [editorKey, setEditorKey] = useState('none');

  const filtered0 = useMemo(
    () => filterNotes(notes, { type: typeFilter || undefined, query }),
    [notes, typeFilter, query],
  );
  const filtered = secretsOnly ? notesWithSecrets(filtered0) : filtered0;
  const current = selected ? notes.find(n => n.id === selected.id) ?? selected : null;
  // Arrastar só na visão "Todas" (sem filtro de tipo nem busca) — ordem global não-ambígua.
  const dragEnabled = !typeFilter && !query.trim() && !secretsOnly;
  const pinned = filtered.filter(n => n.pinned);
  const rest = filtered.filter(n => !n.pinned);

  if (list.isLoading || myIds.isLoading) {
    return <div className="space-y-lg w-full pb-2xl"><LoadingState rows={4} label="Carregando anotações…" /></div>;
  }
  const group = (list.data ?? []).find(g => g.id === groupId);
  const backBtn = <Button variant="secondary" size="md" onClick={() => navigate('/grupos')}><ChevronLeft size={14} /> Voltar pros grupos</Button>;
  if (!group) return <div className="space-y-lg w-full pb-2xl"><EmptyState title="Grupo não encontrado" description="Esse grupo não existe ou foi desativado." action={backBtn} /></div>;

  const isMember = Boolean(groupId && (myIds.data ?? []).includes(groupId));
  const canManage = role === 'director' || role === 'coordinator' || role === 'manager' || group.leader_id === meuId;
  if (!isMember && !canManage) {
    return <div className="space-y-lg w-full pb-2xl"><EmptyState title="Você não está neste grupo" description="Pede pro líder te adicionar pra ver as anotações." action={backBtn} /></div>;
  }

  function nameFor(id: string | null): string | undefined {
    if (!id) return undefined;
    const m = group!.members.find(mm => mm.collaborator_id === id);
    return m ? first(m.full_name) : undefined;
  }

  function openNew() { const n = blankNote(groupId!); setSelected(n); setEditing(true); setPane('doc'); setEditorKey('new:' + Date.now()); }
  function openNote(n: GroupNote) { setSelected(n); setEditing(false); setPane('doc'); setEditorKey('note:' + n.id); }
  function backToList() { setSelected(null); setEditing(false); setPane('list'); }

  async function handleSave(patch: Partial<GroupNote> & { id?: string }) {
    try {
      const id = await save.mutateAsync(patch);
      if (!patch.id) setSelected(prev => (prev ? { ...prev, id } : prev));
    } catch {
      showToast({ kind: 'error', title: 'Não consegui salvar a ficha' });
    }
  }

  function onDragEnd(section: 'pinned' | 'rest', e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const arr = section === 'pinned' ? pinned : rest;
    const oldI = arr.findIndex(n => n.id === active.id);
    const newI = arr.findIndex(n => n.id === over.id);
    if (oldI < 0 || newI < 0) return;
    reorder.mutate(renumber(arrayMove(arr, oldI, newI)));
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <header className="shrink-0">
        <button type="button" onClick={() => navigate(`/grupos/${groupId}`)} className="inline-flex items-center gap-xs text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm">
          <ChevronLeft size={14} /> Grupos · {group.name}
        </button>
        <div className="flex items-center gap-md mt-xs">
          <h1 className="text-screen-title flex items-center gap-sm"><NotebookText size={22} className="text-tom" /> Anotações</h1>
          <div className="ml-auto flex items-center gap-sm">
            <div className="relative max-sm:hidden">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar…"
                className="w-44 bg-bg-surface border border-border rounded-md pl-8 pr-2 py-2 text-body-sm text-fg focus:outline-none focus:border-tom" />
            </div>
            {isMember && <Button variant="primary" size="md" leadingIcon={<Plus size={16} />} onClick={openNew}>Nova ficha</Button>}
          </div>
        </div>
      </header>

      <div className="shrink-0 mt-md"><NotesSummary notes={notes} /></div>
      <div className="shrink-0 mt-md"><NotesTypeFilter notes={notes} value={typeFilter} onChange={setTypeFilter} idx={typeIndex} secretsOnly={secretsOnly} onToggleSecrets={() => setSecretsOnly(v => !v)} /></div>

      <div className="flex-1 min-h-0 mt-md rounded-md border border-border bg-bg-surface overflow-hidden flex">
        <div className={`${pane === 'doc' ? 'max-md:hidden' : ''} w-full md:w-72 shrink-0 md:border-r border-border flex flex-col`}>
          <div className="md:hidden p-sm border-b border-border">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 Buscar…"
              className="w-full bg-bg-app border border-border rounded-md p-2 text-body-sm text-fg focus:outline-none focus:border-tom" />
          </div>
          <div className="flex-1 overflow-y-auto p-sm space-y-sm">
            {loading && <LoadingState rows={4} />}
            {!loading && filtered.length === 0 && (
              <p className="text-body-sm text-fg-muted p-sm">{notes.length === 0 ? 'Nenhuma ficha ainda. Crie a primeira em "Nova ficha".' : 'Nada encontrado com esse filtro.'}</p>
            )}
            {!loading && filtered.length > 0 && (dragEnabled ? (
              <>
                {pinned.length > 0 && <div className={sectionLabel}>📌 Fixadas</div>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => onDragEnd('pinned', e)}>
                  <SortableContext items={pinned.map(n => n.id)} strategy={verticalListSortingStrategy}>
                    {pinned.map(n => <SortableNoteCard key={n.id} note={n} active={current?.id === n.id} onClick={() => openNote(n)} idx={typeIndex} />)}
                  </SortableContext>
                </DndContext>
                {rest.length > 0 && pinned.length > 0 && <div className={sectionLabel}>Demais</div>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => onDragEnd('rest', e)}>
                  <SortableContext items={rest.map(n => n.id)} strategy={verticalListSortingStrategy}>
                    {rest.map(n => <SortableNoteCard key={n.id} note={n} active={current?.id === n.id} onClick={() => openNote(n)} idx={typeIndex} />)}
                  </SortableContext>
                </DndContext>
              </>
            ) : (
              filtered.map(n => <NoteCard key={n.id} note={n} active={current?.id === n.id} onClick={() => openNote(n)} idx={typeIndex} />)
            ))}
          </div>
        </div>

        <div className={`${pane === 'list' ? 'max-md:hidden' : ''} flex-1 min-w-0 flex bg-bg-app/30`}>
          {!current ? (
            <div className="flex-1 hidden md:flex items-center justify-center text-fg-muted text-body-sm">Selecione uma ficha ou crie uma nova.</div>
          ) : editing ? (
            <NoteEditor key={editorKey} note={current} onSave={handleSave} onDone={() => setEditing(false)} onBack={backToList} typeIndex={typeIndex} />
          ) : (
            <NoteDetail
              note={current}
              editorName={nameFor(current.updated_by)}
              idx={typeIndex}
              onEdit={() => setEditing(true)}
              onDelete={(id) => { if (id) remove.mutate(id); backToList(); }}
              onPin={(id, p) => id && pin.mutate({ id, pinned: p })}
              onBack={backToList}
            />
          )}
        </div>
      </div>
    </div>
  );
}
