import { typesWithCount, typeLabel, resolveColor, resolveIcon, type NoteLike, type TypeIndex } from '../../../lib/groupNotes';
import { NoteGlyph } from './IconRegistry';

interface Props { notes: NoteLike[]; value: string | null; onChange: (t: string | null) => void; idx?: TypeIndex; secretsOnly?: boolean; onToggleSecrets?: () => void }

export function NotesTypeFilter({ notes, value, onChange, idx, secretsOnly, onToggleSecrets }: Props) {
  const types = typesWithCount(notes);
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 text-body-sm px-md py-1.5 rounded-full border transition-colors focus-ring ${
      active ? 'bg-tom text-black border-tom font-medium' : 'border-border text-fg-muted hover:bg-bg-elevated'
    }`;
  return (
    <div className="flex items-center gap-xs flex-wrap">
      <button type="button" className={chip(!value)} onClick={() => onChange(null)}>Todas</button>
      {types.map(({ type, count }) => (
        <button key={type} type="button" className={chip(value === type)} onClick={() => onChange(value === type ? null : type)}>
          <NoteGlyph name={resolveIcon({ type, icon: null }, idx)} color={value === type ? undefined : resolveColor({ type, color: null }, idx)} size={14} /> {typeLabel(type, idx)} {count}
        </button>
      ))}
      {onToggleSecrets && notes.some((n) => (n.fields || []).some((f) => f.secret)) && (
        <button type="button" className={chip(!!secretsOnly)} onClick={onToggleSecrets}>🔑 Senhas</button>
      )}
    </div>
  );
}
