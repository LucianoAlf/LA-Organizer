import { Pin } from 'lucide-react';
import { cardSubtitle, type GroupNote } from '../../../lib/groupNotes';
import { TypeIcon } from './TypeIcon';
import { brShort } from '../../../utils/date';

function whenLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `há ${days} d`;
  return brShort(iso.slice(0, 10));
}

export function NoteCard({ note, active, onClick }: { note: GroupNote; active: boolean; onClick: () => void }) {
  const sub = cardSubtitle(note);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-md border p-md transition-colors focus-ring ${
        active ? 'border-tom bg-tom/5' : 'border-border bg-bg-surface hover:bg-bg-elevated'
      }`}
    >
      <div className="flex items-center gap-sm">
        <TypeIcon type={note.type} size={15} className="text-fg-muted shrink-0" />
        <span className="flex-1 min-w-0 truncate text-body-md font-medium text-fg">{note.title || 'Sem título'}</span>
        {note.pinned && <Pin size={13} className="text-fg-muted shrink-0" aria-label="Fixada" />}
      </div>
      {sub && <div className="text-body-sm text-fg-muted truncate mt-xs">{sub}</div>}
      <div className="flex items-center gap-xs mt-sm">
        {note.tags.slice(0, 3).map(t => (
          <span key={t} className="text-caption px-sm py-[2px] rounded-full bg-tom/10 text-tom">{t}</span>
        ))}
        {note.tags.length === 0 && note.updated_at && (
          <span className="text-caption text-fg-muted">{whenLabel(note.updated_at)}</span>
        )}
      </div>
    </button>
  );
}
