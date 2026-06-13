import { useEffect, useRef, useState } from 'react';
import { Plus, X, ArrowLeft, Check } from 'lucide-react';
import { CustomSelect } from '../../../components/CustomSelect';
import { NOTE_TYPES, NOTE_TYPE_META, templateFor, type GroupNote, type NoteField, type NoteType } from '../../../lib/groupNotes';

interface Props {
  note: Partial<GroupNote>;
  onSave: (patch: Partial<GroupNote> & { id?: string }) => void;
  onDone: () => void; onBack?: () => void;
}

const typeOpts = NOTE_TYPES.map(t => ({ value: t, label: NOTE_TYPE_META[t].label }));

export function NoteEditor({ note, onSave, onDone, onBack }: Props) {
  const [draft, setDraft] = useState<Partial<GroupNote>>(() => ({
    title: note.title || '', type: note.type || 'acesso',
    fields: note.fields && note.fields.length ? note.fields.map(f => ({ ...f })) : templateFor((note.type as NoteType) || 'acesso'),
    tags: note.tags || [], body: note.body || '',
  }));
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  function commit(next: Partial<GroupNote>) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave({ ...next, id: note.id }), 600);
  }
  function patch(p: Partial<GroupNote>) {
    setDraft(d => { const next = { ...d, ...p }; commit(next); return next; });
  }
  function changeType(t: NoteType) {
    const pristine = (draft.fields || []).every(f => !f.value);
    patch(pristine ? { type: t, fields: templateFor(t) } : { type: t });
  }
  function setField(i: number, p: Partial<NoteField>) {
    const fields = (draft.fields || []).map((f, idx) => (idx === i ? { ...f, ...p } : f));
    patch({ fields });
  }
  function addField() { patch({ fields: [...(draft.fields || []), { label: '', value: '', kind: 'text' }] }); }
  function removeField(i: number) { patch({ fields: (draft.fields || []).filter((_, idx) => idx !== i) }); }

  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  return (
    <div className="flex-1 min-w-0 p-lg overflow-y-auto">
      <div className="flex items-center gap-sm mb-md">
        {onBack && <button className="md:hidden text-fg-muted p-1 -ml-1 focus-ring rounded-sm" onClick={() => { onDone(); onBack(); }} aria-label="Voltar"><ArrowLeft size={18} /></button>}
        <span className="text-label uppercase tracking-wide text-fg-muted flex-1">{note.id ? 'Editando ficha' : 'Nova ficha'}</span>
        <button onClick={onDone} className="inline-flex items-center gap-1 text-body-sm text-tom font-medium focus-ring rounded-sm px-2 py-1"><Check size={15} /> Pronto</button>
      </div>

      <input value={draft.title || ''} onChange={e => patch({ title: e.target.value })} placeholder="Título da ficha"
        className={`${inputCls} text-body-lg font-semibold mb-sm`} />

      <div className="flex items-center gap-sm mb-md">
        <span className="text-body-sm text-fg-muted">Tipo</span>
        <CustomSelect value={draft.type || 'acesso'} options={typeOpts} onChange={v => changeType(v as NoteType)} size="sm" />
      </div>

      <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Campos</div>
      <div className="space-y-xs mb-sm">
        {(draft.fields || []).map((f, i) => (
          <div key={i} className="flex items-center gap-xs">
            <input value={f.label} onChange={e => setField(i, { label: e.target.value })} placeholder="Rótulo"
              className="w-28 shrink-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
            <input value={f.value} onChange={e => setField(i, { value: e.target.value })} placeholder="Valor"
              type={f.secret ? 'password' : 'text'}
              className="flex-1 min-w-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
            <button type="button" onClick={() => setField(i, { secret: !f.secret, kind: !f.secret ? 'password' : 'text' })}
              aria-label="Marcar como senha"
              className={`text-caption px-2 py-1 rounded-md border shrink-0 ${f.secret ? 'border-tom text-tom' : 'border-border text-fg-muted'}`}>secreto</button>
            <button type="button" onClick={() => removeField(i)} aria-label="Remover campo" className="text-fg-muted hover:text-danger p-1 shrink-0 focus-ring rounded-sm"><X size={15} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addField} className="inline-flex items-center gap-1 text-body-sm text-tom mb-lg focus-ring rounded-sm"><Plus size={14} /> Adicionar campo</button>

      <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Tags</div>
      <input value={(draft.tags || []).join(', ')} onChange={e => patch({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
        placeholder="Recreio, Zoho" className={`${inputCls} text-body-sm mb-md`} />

      <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Anotações livres (markdown)</div>
      <textarea value={draft.body || ''} onChange={e => patch({ body: e.target.value })} rows={6} placeholder="Observações, contexto, lista…"
        className={`${inputCls} text-body-sm font-mono`} />
    </div>
  );
}
