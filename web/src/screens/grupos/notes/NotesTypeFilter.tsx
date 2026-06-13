import { NOTE_TYPE_META, typesWithCount, type GroupNote, type NoteType } from '../../../lib/groupNotes';
import { TypeIcon } from './TypeIcon';

interface Props { notes: GroupNote[]; value: NoteType | null; onChange: (t: NoteType | null) => void }

export function NotesTypeFilter({ notes, value, onChange }: Props) {
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
          <TypeIcon type={type} size={14} /> {NOTE_TYPE_META[type].label} {count}
        </button>
      ))}
    </div>
  );
}
