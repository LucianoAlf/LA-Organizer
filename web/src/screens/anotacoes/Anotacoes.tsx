// Módulo Anotações pessoais (tabela notes) — two-pane igual ao grupo: fichas tipadas,
// editor rico + IA semântica, cor/ícone, reorder, tipos custom por usuário, senhas
// cifradas. Preserva o que é do pessoal (virar-tarefas, compartilhar, arquivar) no
// NotaDetalhe. Reusa os componentes agnósticos de screens/grupos/notes/.
import { useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Search, NotebookText, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNotes, useNoteTypes, type Note } from '../../hooks/useNotes';
import { useSortableSensors } from '../../lib/sortableSensors';
import { filterNotes, renumber, buildTypeIndex, notesWithSecrets, templateForType, type TypeIndex } from '../../lib/personalNotes';
import { Button } from '../../components/Button';
import { LoadingState } from '../../components/LoadingState';
import { showToast } from '../../components/Toast';
import { NotesSummary } from '../grupos/notes/NotesSummary';
import { NotesTypeFilter } from '../grupos/notes/NotesTypeFilter';
import { NoteCard } from '../grupos/notes/NoteCard';
import { NoteEditor } from '../grupos/notes/NoteEditor';
import { NotaDetalhe } from './NotaDetalhe';

const sectionLabel = 'text-caption uppercase tracking-wide text-fg-muted px-xs pt-xs pb-[2px]';

// Card arrastável: grip = activator (handle-only); o card abre no clique normal.
function SortableNoteCard({ note, active, onClick, idx }: { note: Note; active: boolean; onClick: () => void; idx?: TypeIndex }) {
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

export function Anotacoes() {
  const { id: routeId } = useParams<{ id?: string }>();
  const { list, createNote, updateNote, deleteNote, reorder, meuId } = useNotes();
  const { types, saveType, removeType } = useNoteTypes();
  const typeIndex = useMemo(() => buildTypeIndex(types), [types]);
  const sensors = useSortableSensors();

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [secretsOnly, setSecretsOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(routeId ?? null);
  const [editing, setEditing] = useState(false);
  const [pane, setPane] = useState<'list' | 'doc'>(routeId ? 'doc' : 'list');
  // key do editor: muda a cada abertura → remonta limpo (evita draft preso).
  const [editorKey, setEditorKey] = useState('none');

  const notes = list.data ?? [];
  const onlyMine = useMemo(() => notes.filter((n) => n.collaborator_id === meuId), [notes, meuId]);
  const filtered0 = useMemo(() => filterNotes(notes, { type: typeFilter || undefined, query }), [notes, typeFilter, query]);
  const filtered = secretsOnly ? notesWithSecrets(filtered0) : filtered0;
  const current = selectedId ? notes.find((n) => n.id === selectedId) ?? null : null;
  const dragEnabled = !typeFilter && !query.trim() && !secretsOnly;
  const pinned = filtered.filter((n) => n.pinned);
  const rest = filtered.filter((n) => !n.pinned);

  if (list.isLoading) return <div className="space-y-lg w-full pb-2xl"><LoadingState rows={4} label="Carregando anotações…" /></div>;

  async function openNew() {
    try {
      const n = await createNote.mutateAsync({ type: 'livre', fields: templateForType('livre', typeIndex) });
      setSelectedId(n.id); setEditing(true); setPane('doc'); setEditorKey('note:' + n.id);
    } catch { showToast({ kind: 'error', title: 'Não consegui criar a ficha' }); }
  }
  function openNote(n: Note) { setSelectedId(n.id); setEditing(false); setPane('doc'); setEditorKey('note:' + n.id); }
  function backToList() { setSelectedId(null); setEditing(false); setPane('list'); }

  async function handleSave(patch: Partial<Note> & { id?: string }) {
    if (!patch.id) return;
    const { id, ...rest } = patch;
    try { await updateNote.mutateAsync({ id, patch: rest }); }
    catch { showToast({ kind: 'error', title: 'Não consegui salvar a ficha' }); }
  }

  function onDragEnd(section: 'pinned' | 'rest', e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const arr = section === 'pinned' ? pinned : rest;
    const oldI = arr.findIndex((n) => n.id === active.id);
    const newI = arr.findIndex((n) => n.id === over.id);
    if (oldI < 0 || newI < 0) return;
    reorder.mutate(renumber(arrayMove(arr, oldI, newI)));
  }

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <header className="shrink-0">
        <div className="flex items-center gap-md">
          <h1 className="text-screen-title flex items-center gap-sm"><NotebookText size={22} className="text-tom" /> Anotações</h1>
          <div className="ml-auto flex items-center gap-sm">
            <div className="relative max-sm:hidden">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…"
                className="w-44 bg-bg-surface border border-border rounded-md pl-8 pr-2 py-2 text-body-sm text-fg focus:outline-none focus:border-tom" />
            </div>
            <Button variant="primary" size="md" leadingIcon={<Plus size={16} />} onClick={openNew}>Nova ficha</Button>
          </div>
        </div>
        <p className="text-body-sm text-fg-muted mt-xs">Dita pro TOM ("anota aí…") ou cria aqui — fichas tipadas, senhas e "virar tarefas".</p>
      </header>

      <div className="shrink-0 mt-md"><NotesSummary notes={onlyMine} /></div>
      <div className="shrink-0 mt-md"><NotesTypeFilter notes={notes} value={typeFilter} onChange={setTypeFilter} idx={typeIndex} secretsOnly={secretsOnly} onToggleSecrets={() => setSecretsOnly((v) => !v)} /></div>

      <div className="flex-1 min-h-0 mt-md rounded-md border border-border bg-bg-surface overflow-hidden flex">
        <div className={`${pane === 'doc' ? 'max-md:hidden' : ''} w-full md:w-72 shrink-0 md:border-r border-border flex flex-col`}>
          <div className="md:hidden p-sm border-b border-border">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar…"
              className="w-full bg-bg-app border border-border rounded-md p-2 text-body-sm text-fg focus:outline-none focus:border-tom" />
          </div>
          <div className="flex-1 overflow-y-auto p-sm space-y-sm">
            {filtered.length === 0 && (
              <p className="text-body-sm text-fg-muted p-sm">{notes.length === 0 ? 'Nenhuma ficha ainda. Crie a primeira em "Nova ficha".' : 'Nada encontrado com esse filtro.'}</p>
            )}
            {filtered.length > 0 && (dragEnabled ? (
              <>
                {pinned.length > 0 && <div className={sectionLabel}>📌 Fixadas</div>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd('pinned', e)}>
                  <SortableContext items={pinned.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                    {pinned.map((n) => <SortableNoteCard key={n.id} note={n} active={current?.id === n.id} onClick={() => openNote(n)} idx={typeIndex} />)}
                  </SortableContext>
                </DndContext>
                {rest.length > 0 && pinned.length > 0 && <div className={sectionLabel}>Demais</div>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onDragEnd('rest', e)}>
                  <SortableContext items={rest.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                    {rest.map((n) => <SortableNoteCard key={n.id} note={n} active={current?.id === n.id} onClick={() => openNote(n)} idx={typeIndex} />)}
                  </SortableContext>
                </DndContext>
              </>
            ) : (
              filtered.map((n) => <NoteCard key={n.id} note={n} active={current?.id === n.id} onClick={() => openNote(n)} idx={typeIndex} />)
            ))}
          </div>
        </div>

        <div className={`${pane === 'list' ? 'max-md:hidden' : ''} flex-1 min-w-0 flex bg-bg-app/30`}>
          {!current ? (
            <div className="flex-1 hidden md:flex items-center justify-center text-fg-muted text-body-sm">Selecione uma ficha ou crie uma nova.</div>
          ) : editing && current.collaborator_id === meuId ? (
            <NoteEditor key={editorKey} note={current} onSave={handleSave} onDone={() => setEditing(false)} onBack={backToList} typeIndex={typeIndex}
              onSaveType={async (t) => { const c = await saveType.mutateAsync(t); return c.key; }}
              onDeleteType={async (id) => { await removeType.mutateAsync(id); }} />
          ) : (
            <NotaDetalhe note={current} idx={typeIndex} onEdit={() => setEditing(true)} onBack={backToList} onDeleted={backToList} />
          )}
        </div>
      </div>
    </div>
  );
}
