import { categoriesWithCount, allTags, type GroupNote } from '../../../lib/groupNotes';

interface Props { notes: GroupNote[]; category: string | null; tag: string | null;
  onCategory: (c: string | null) => void; onTag: (t: string | null) => void; }

export function NotesRail({ notes, category, tag, onCategory, onTag }: Props) {
  const cats = categoriesWithCount(notes);
  const tags = allTags(notes);
  const item = (active: boolean) => `w-full text-left px-sm py-xs rounded-sm text-body-sm flex justify-between items-center ${active ? 'bg-tom/10 text-tom font-medium' : 'text-fg-muted hover:bg-bg-elevated'}`;
  return (
    <div className="w-40 shrink-0 border-r border-border p-sm space-y-xs overflow-y-auto">
      <p className="text-caption uppercase tracking-wide text-fg-muted px-sm pt-xs">Categorias</p>
      <button className={item(!category)} onClick={() => onCategory(null)}><span>Todas</span><span>{notes.length}</span></button>
      {cats.map((c) => (
        <button key={c.category} className={item(category === c.category)} onClick={() => onCategory(c.category)}>
          <span className="truncate">{c.category}</span><span>{c.count}</span></button>
      ))}
      {tags.length > 0 && <p className="text-caption uppercase tracking-wide text-fg-muted px-sm pt-sm">Tags</p>}
      <div className="flex flex-wrap gap-xs px-sm">
        {tags.map((t) => (
          <button key={t} onClick={() => onTag(tag === t ? null : t)}
            className={`text-caption px-sm py-[2px] rounded-full border ${tag === t ? 'bg-tom/15 text-tom border-tom' : 'border-border text-fg-muted'}`}>#{t}</button>
        ))}
      </div>
    </div>
  );
}
