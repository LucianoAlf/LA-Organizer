import { noteExcerpt, type GroupNote } from '../../../lib/groupNotes';

interface Props { notes: GroupNote[]; selectedId: string | null; query: string;
  onQuery: (q: string) => void; onSelect: (n: GroupNote) => void; onNew: () => void; }

export function NotesList({ notes, selectedId, query, onQuery, onSelect, onNew }: Props) {
  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col">
      <div className="p-sm border-b border-border flex gap-xs">
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="🔍 Buscar…"
          className="flex-1 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
        <button onClick={onNew} className="bg-tom text-black rounded-md px-2 text-body-sm font-semibold" aria-label="Nova anotação">+</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {notes.length === 0 && <p className="text-body-sm text-fg-muted p-sm">Nenhuma anotação.</p>}
        {notes.map((n) => (
          <button key={n.id} onClick={() => onSelect(n)}
            className={`w-full text-left px-sm py-2 border-b border-border ${selectedId === n.id ? 'bg-bg-elevated' : 'hover:bg-bg-elevated/50'}`}>
            <div className="text-body-sm font-medium text-fg flex items-center gap-xs">{n.pinned && <span>📌</span>}{n.title || 'Sem título'}</div>
            <div className="text-caption text-fg-muted truncate">{noteExcerpt(n.body, 60) || n.category}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
