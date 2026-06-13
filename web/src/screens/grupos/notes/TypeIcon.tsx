import { TYPE_DEFAULTS, type NoteType } from '../../../lib/groupNotes';
import { NoteGlyph } from './IconRegistry';

// Ícone do TIPO (usado nos chips de filtro). Delega ao registry via NoteGlyph.
export function TypeIcon({ type, size = 16, className }: { type: NoteType; size?: number; className?: string }) {
  return <NoteGlyph name={TYPE_DEFAULTS[type].icon} size={size} className={className} />;
}
