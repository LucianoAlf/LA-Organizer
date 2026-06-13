import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { CustomSelect } from '../../../components/CustomSelect';
import type { GroupNote } from '../../../lib/groupNotes';

interface Props { note: GroupNote | null; allCategories: string[];
  onSave: (patch: Partial<GroupNote> & { id?: string }) => void; onDelete: (id: string) => void; onPin: (id: string, pinned: boolean) => void; onBack?: () => void; }

export function NoteDoc({ note, allCategories, onSave, onDelete, onPin, onBack }: Props) {
  const [edit, setEdit] = useState(!note?.id);
  const [draft, setDraft] = useState<Partial<GroupNote>>(note ?? { title: '', category: 'Geral', tags: [], body: '' });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setDraft(note ?? { title: '', category: 'Geral', tags: [], body: '' }); setEdit(!note?.id); }, [note?.id]);

  function patch(p: Partial<GroupNote>) {
    setDraft((d) => { const next = { ...d, ...p }; clearTimeout(timer.current); timer.current = setTimeout(() => onSave({ ...next, id: note?.id }), 600); return next; });
  }
  if (!note && !edit) return <div className="flex-1 flex items-center justify-center text-fg-muted text-body-sm">Selecione uma anotação</div>;

  const catOpts = [...new Set([...allCategories, 'Acessos', 'CNPJs', 'Contas', 'Reuniões', 'Geral'])].map((c) => ({ value: c, label: c }));
  const html = DOMPurify.sanitize(marked.parse(draft.body || '', { async: false }) as string);

  return (
    <div className="flex-1 p-md overflow-y-auto">
      <div className="flex items-center gap-sm mb-sm">
        {onBack && <button className="text-fg-muted md:hidden" onClick={onBack}>←</button>}
        <div className="flex-1" />
        {note?.id && <button className="text-body-sm text-fg-muted" onClick={() => onPin(note.id, !note.pinned)}>{note.pinned ? '📌 Fixada' : '📌 Fixar'}</button>}
        <button className="text-body-sm text-tom font-medium" onClick={() => setEdit((v) => !v)}>{edit ? 'Pronto' : 'Editar'}</button>
        {note?.id && <button className="text-body-sm text-danger" onClick={() => onDelete(note.id)}>Excluir</button>}
      </div>
      {edit ? (
        <div className="space-y-sm">
          <input value={draft.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder="Título"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-body-lg font-semibold text-fg focus:outline-none focus:border-tom" />
          <div className="flex gap-sm items-center">
            <CustomSelect value={draft.category || 'Geral'} options={catOpts} onChange={(v) => patch({ category: v })} size="sm" />
            <input value={(draft.tags || []).join(', ')} onChange={(e) => patch({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="tags: Recreio, Zoho" className="flex-1 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
          </div>
          <textarea value={draft.body || ''} onChange={(e) => patch({ body: e.target.value })} rows={14} placeholder="Conteúdo (markdown)…"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-body-sm text-fg font-mono focus:outline-none focus:border-tom" />
        </div>
      ) : (
        <>
          <h2 className="text-h3 text-fg">{draft.title}</h2>
          <p className="text-caption text-fg-muted mb-sm">👥 do grupo{(draft.tags || []).length ? ' · ' + (draft.tags || []).map((t) => '#' + t).join(' ') : ''}</p>
          <div className="prose-tom text-body-sm text-fg [&_h1]:text-h3 [&_h2]:text-body-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-tom [&_code]:bg-bg-elevated [&_code]:px-1 [&_code]:rounded" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
    </div>
  );
}
