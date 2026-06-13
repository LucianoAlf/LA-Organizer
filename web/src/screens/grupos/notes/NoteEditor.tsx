import { useEffect, useRef, useState } from 'react';
import { Plus, X, ArrowLeft, Check } from 'lucide-react';
import { CustomSelect } from '../../../components/CustomSelect';
import { NOTE_COLORS, NOTE_ICONS, templateForType, resolveColor, resolveIcon, isEncrypted, type GroupNote, type NoteField, type TypeIndex } from '../../../lib/groupNotes';
import { NoteGlyph } from './IconRegistry';
import { RichEditor } from './RichEditor';
import { NoteTypeForm } from './NoteTypeForm';

interface Props {
  note: Partial<GroupNote>;
  onSave: (patch: Partial<GroupNote> & { id?: string }) => void | Promise<unknown>;
  onDone: () => void; onBack?: () => void;
  typeIndex: TypeIndex;
}

// typeOpts é montado no componente a partir do typeIndex (5 base + custom do grupo).

export function NoteEditor({ note, onSave, onDone, onBack, typeIndex }: Props) {
  const [draft, setDraft] = useState<Partial<GroupNote>>(() => ({
    title: note.title || '', type: note.type || 'acesso',
    fields: note.fields && note.fields.length ? note.fields.map(f => ({ ...f })) : templateForType(note.type || 'acesso', typeIndex),
    tags: note.tags || [], body: note.body || '', color: note.color ?? null, icon: note.icon ?? null,
  }));
  const [showTypeForm, setShowTypeForm] = useState(false);
  const typeOpts = Object.entries(typeIndex).map(([value, m]) => ({ value, label: m.label }));
  const draftType = draft.type || 'acesso';
  const activeColor = resolveColor({ type: draftType, color: draft.color ?? null }, typeIndex);
  const activeIcon = resolveIcon({ type: draftType, icon: draft.icon ?? null }, typeIndex);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => () => clearTimeout(timer.current), []);

  function commit(next: Partial<GroupNote>) {
    clearTimeout(timer.current);
    setSaveState('saving');
    timer.current = setTimeout(async () => {
      try { await onSave({ ...next, id: note.id }); setSaveState('saved'); }
      catch { setSaveState('idle'); }
    }, 600);
  }
  function patch(p: Partial<GroupNote>) {
    setDraft(d => { const next = { ...d, ...p }; commit(next); return next; });
  }
  function changeType(t: string) {
    const pristine = (draft.fields || []).every(f => !f.value);
    patch(pristine ? { type: t, fields: templateForType(t, typeIndex) } : { type: t });
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
        <span className="text-caption text-fg-muted">{saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? 'Salvo ✓' : ''}</span>
        <button onClick={onDone} className="inline-flex items-center gap-1 text-body-sm text-tom font-medium focus-ring rounded-sm px-2 py-1"><Check size={15} /> Pronto</button>
      </div>

      <input value={draft.title || ''} onChange={e => patch({ title: e.target.value })} placeholder="Título da ficha"
        className={`${inputCls} text-body-lg font-semibold mb-sm`} />

      <div className="flex items-center gap-sm mb-md">
        <span className="text-body-sm text-fg-muted shrink-0">Tipo</span>
        <div className="flex-1 min-w-0 max-w-[280px]">
          <CustomSelect value={draft.type || 'acesso'} options={typeOpts} onChange={(v) => changeType(v)} size="sm"
            footerAction={{ label: '➕ Novo tipo…', onClick: () => setShowTypeForm(true) }} />
        </div>
      </div>

      <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Aparência</div>
      <div className="flex flex-wrap gap-xs mb-sm">
        {NOTE_COLORS.map(c => (
          <button key={c} type="button" onClick={() => patch({ color: c })} aria-label={`Cor ${c}`}
            className="w-6 h-6 rounded-full focus-ring shrink-0"
            style={{ background: c, outline: activeColor === c ? '2px solid var(--color-fg, currentColor)' : 'none', outlineOffset: 2 }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-xs mb-md">
        {NOTE_ICONS.map(ic => (
          <button key={ic} type="button" onClick={() => patch({ icon: ic })} aria-label={ic}
            className={`grid place-items-center w-8 h-8 rounded-md border shrink-0 ${activeIcon === ic ? 'border-tom text-tom' : 'border-border text-fg-muted'}`}>
            <NoteGlyph name={ic} size={16} color={activeIcon === ic ? activeColor : undefined} />
          </button>
        ))}
      </div>

      <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Campos</div>
      <div className="space-y-xs mb-sm">
        {(draft.fields || []).map((f, i) => (
          <div key={i} className="flex items-center gap-xs">
            <input value={f.label} onChange={e => setField(i, { label: e.target.value })} placeholder="Rótulo"
              className="w-28 shrink-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
            <input value={f.secret && isEncrypted(f.value || '') ? '' : f.value} onChange={e => setField(i, { value: e.target.value })}
              placeholder={f.secret && isEncrypted(f.value || '') ? '•••• (inalterado)' : 'Valor'}
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

      <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Anotações livres</div>
      <RichEditor valueHtml={draft.body || ''} onChange={(html) => patch({ body: html })} />

      {showTypeForm && note.group_id && (
        <NoteTypeForm groupId={note.group_id} onClose={() => setShowTypeForm(false)}
          onSaved={(key) => { setShowTypeForm(false); changeType(key); }} />
      )}
    </div>
  );
}
