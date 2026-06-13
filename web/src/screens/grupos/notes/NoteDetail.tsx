import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Pin, PinOff, Pencil, Trash2, ArrowLeft, MessageSquare } from 'lucide-react';
import { NOTE_TYPE_META, resolveColor, resolveIcon, type GroupNote } from '../../../lib/groupNotes';
import { NoteGlyph } from './IconRegistry';
import { FieldRow } from './FieldRow';

function whenLabel(iso: string): string {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

interface Props {
  note: GroupNote; editorName?: string;
  onEdit: () => void; onDelete: (id: string) => void; onPin: (id: string, pinned: boolean) => void; onBack?: () => void;
}

export function NoteDetail({ note, editorName, onEdit, onDelete, onPin, onBack }: Props) {
  const meta = NOTE_TYPE_META[note.type];
  const fields = (note.fields || []).filter(f => f.label || f.value);
  const bodyHtml = note.body ? DOMPurify.sanitize(marked.parse(note.body, { async: false, breaks: true }) as string) : '';

  return (
    <div className="flex-1 min-w-0 p-lg overflow-y-auto">
      <div className="flex items-center gap-sm mb-xs">
        {onBack && <button className="md:hidden text-fg-muted p-1 -ml-1 focus-ring rounded-sm" onClick={onBack} aria-label="Voltar"><ArrowLeft size={18} /></button>}
        <NoteGlyph name={resolveIcon(note)} color={resolveColor(note)} size={20} className="shrink-0" />
        <h2 className="flex-1 min-w-0 truncate text-h3 text-fg">{note.title}</h2>
        <div className="flex items-center gap-1 shrink-0 text-fg-muted">
          <button onClick={() => onPin(note.id, !note.pinned)} aria-label={note.pinned ? 'Desafixar' : 'Fixar'} className="p-1.5 rounded-sm hover:text-fg focus-ring">{note.pinned ? <Pin size={17} className="text-tom" /> : <PinOff size={17} />}</button>
          <button onClick={onEdit} aria-label="Editar" className="p-1.5 rounded-sm hover:text-fg focus-ring"><Pencil size={17} /></button>
          <button onClick={() => onDelete(note.id)} aria-label="Excluir" className="p-1.5 rounded-sm hover:text-danger focus-ring"><Trash2 size={17} /></button>
        </div>
      </div>

      <div className="flex items-center gap-xs text-caption text-fg-muted mb-lg">
        <span>👥 do grupo</span>
        {note.updated_at && <span>· editado{editorName ? ` por ${editorName}` : ''} {whenLabel(note.updated_at)}</span>}
        <span className="px-sm py-[2px] rounded-full bg-tom/10 text-tom">{meta.label}</span>
      </div>

      {fields.length > 0 && (
        <div className="border-b border-border mb-lg">
          {fields.map((f, i) => <FieldRow key={i} field={f} />)}
        </div>
      )}

      {bodyHtml && (
        <div className="mb-lg">
          <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Anotações livres</div>
          <div
            className="text-body-md text-fg-muted leading-relaxed [&_h1]:text-h3 [&_h2]:text-body-lg [&_h2]:font-semibold [&_h2]:text-fg [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-tom [&_code]:bg-bg-elevated [&_code]:px-1 [&_code]:rounded [&_strong]:text-fg"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        </div>
      )}

      {fields.length === 0 && !bodyHtml && (
        <p className="text-body-sm text-fg-muted">Ficha vazia — toque em editar pra preencher.</p>
      )}

      <div className="flex items-center gap-sm p-sm rounded-md bg-bg-elevated">
        <MessageSquare size={16} className="text-tom shrink-0" aria-hidden />
        <span className="text-caption text-fg-muted">Fixe a ficha (📌) pro TOM responder com esses dados quando alguém perguntar no chat do grupo.</span>
      </div>
    </div>
  );
}
