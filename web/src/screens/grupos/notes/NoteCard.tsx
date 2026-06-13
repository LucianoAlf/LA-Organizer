import { Pin } from 'lucide-react';
import { resolveColor, resolveIcon, type GroupNote } from '../../../lib/groupNotes';
import { NoteGlyph } from './IconRegistry';

// Data curta local (BRT do navegador) — evita o shift de UTC do slice(0,10) (project_localymd_utc_shift).
function shortDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return ''; }
}

// Card compacto: título na 1ª linha (largura total) + data de criação na 2ª. Accent à esquerda.
export function NoteCard({ note, active, onClick }: { note: GroupNote; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderLeftColor: resolveColor(note), borderLeftWidth: 4 }}
      className={`w-full text-left rounded-sm border px-md py-sm transition-colors focus-ring flex items-start gap-sm ${
        active ? 'border-tom bg-tom/5' : 'border-border bg-bg-surface hover:bg-bg-elevated'
      }`}
    >
      <NoteGlyph name={resolveIcon(note)} color={resolveColor(note)} size={15} className="shrink-0 mt-[3px]" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-sm">
          <span className="flex-1 min-w-0 line-clamp-2 text-body-md font-medium text-fg">{note.title || 'Sem título'}</span>
          {note.pinned && <Pin size={13} className="text-fg-muted shrink-0 mt-[3px]" aria-label="Fixada" />}
        </div>
        {note.created_at && <div className="text-caption text-fg-muted mt-[2px] tabular-nums">{shortDate(note.created_at)}</div>}
      </div>
    </button>
  );
}
