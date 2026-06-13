import { useMemo, useState } from 'react';
import { useGroupNotes } from '../../../hooks/useGroupNotes';
import { filterNotes, categoriesWithCount, type GroupNote } from '../../../lib/groupNotes';
import { NotesRail } from './NotesRail';
import { NotesList } from './NotesList';
import { NoteDoc } from './NoteDoc';

export function GroupNotesEnv({ groupId }: { groupId: string }) {
  const { notes, save, remove, pin } = useGroupNotes(groupId);
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GroupNote | null>(null);
  const [mobilePane, setMobilePane] = useState<'list' | 'doc'>('list');

  const filtered = useMemo(() => filterNotes(notes, { category: category || undefined, tag: tag || undefined, query }), [notes, category, tag, query]);
  const allCats = categoriesWithCount(notes).map((c) => c.category);
  const current = selected ? notes.find((n) => n.id === selected.id) ?? selected : null;

  function openNew() { setSelected({ id: '', group_id: groupId, category: 'Geral', tags: [], title: '', body: '', pinned: false, created_by: null, updated_by: null, created_at: '', updated_at: '' }); setMobilePane('doc'); }
  function onSelect(n: GroupNote) { setSelected(n); setMobilePane('doc'); }

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden md:flex"><NotesRail notes={notes} category={category} tag={tag} onCategory={setCategory} onTag={setTag} /></div>
      <div className={`${mobilePane === 'doc' ? 'hidden md:flex' : 'flex'} flex-col`}><NotesList notes={filtered} selectedId={current?.id || null} query={query} onQuery={setQuery} onSelect={onSelect} onNew={openNew} /></div>
      <div className={`${mobilePane === 'list' ? 'hidden md:flex' : 'flex'} flex-1`}>
        <NoteDoc note={current} allCategories={allCats}
          onSave={(p) => save.mutate(p)}
          onDelete={(id) => { remove.mutate(id); setSelected(null); setMobilePane('list'); }}
          onPin={(id, p) => pin.mutate({ id, pinned: p })}
          onBack={() => { setSelected(null); setMobilePane('list'); }} />
      </div>
    </div>
  );
}
