import { Pin } from 'lucide-react';
import { resolveColor, resolveIcon, type GroupNote, type TypeIndex } from '../../../lib/groupNotes';
import { NoteGlyph } from './IconRegistry';

// Card compacto: só o ícone + título (sem data). Accent colorido à esquerda.
export function NoteCard({ note, active, onClick, idx }: { note: GroupNote; active: boolean; onClick: () => void; idx?: TypeIndex }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderLeftColor: resolveColor(note, idx), borderLeftWidth: 4 }}
      className={`w-full text-left rounded-sm border px-md py-sm transition-colors focus-ring flex items-start gap-sm ${
        active ? 'border-tom bg-tom/5' : 'border-border bg-bg-surface hover:bg-bg-elevated'
      }`}
    >
      <NoteGlyph name={resolveIcon(note, idx)} color={resolveColor(note, idx)} size={15} className="shrink-0 mt-[3px]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-sm">
          <span className="flex-1 min-w-0 line-clamp-2 text-body-md font-medium text-fg">{note.title || 'Sem título'}</span>
          {note.pinned && <Pin size={13} className="text-fg-muted shrink-0 mt-[3px]" aria-label="Fixada" />}
        </div>
      </div>
    </button>
  );
}
