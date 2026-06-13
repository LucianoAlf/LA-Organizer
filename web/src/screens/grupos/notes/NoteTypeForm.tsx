import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { NOTE_COLORS, NOTE_ICONS, slugifyType, type NoteField, type FieldKind } from '../../../lib/groupNotes';
import { useGroupNoteTypes } from '../../../hooks/useGroupNoteTypes';
import { NoteGlyph } from './IconRegistry';
import { Button } from '../../../components/Button';
import { showToast } from '../../../components/Toast';

const KINDS: { value: FieldKind; label: string }[] = [
  { value: 'text', label: 'Texto' }, { value: 'password', label: 'Senha' }, { value: 'url', label: 'Link' },
];

// Cria um tipo de ficha custom (nome + cor + ícone + campos do modelo).
// Grupo: passa groupId (usa useGroupNoteTypes). Pessoal: passa onCreate (salva via note_types).
export function NoteTypeForm({ groupId, onSaved, onClose, onCreate }: {
  groupId?: string; onSaved: (key: string) => void; onClose: () => void;
  onCreate?: (t: { key: string; label: string; color: string; icon: string; fields: NoteField[] }) => Promise<string>;
}) {
  const { saveType } = useGroupNoteTypes(groupId ?? '');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string>(NOTE_COLORS[5]);
  const [icon, setIcon] = useState<string>('FileText');
  const [fields, setFields] = useState<NoteField[]>([{ label: '', value: '', kind: 'text' }]);
  const [saving, setSaving] = useState(false);

  function setField(i: number, p: Partial<NoteField>) { setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...p } : f))); }
  function addField() { setFields((fs) => [...fs, { label: '', value: '', kind: 'text' }]); }
  function removeField(i: number) { setFields((fs) => fs.filter((_, idx) => idx !== i)); }

  async function save() {
    const name = label.trim();
    if (!name) { showToast({ kind: 'error', title: 'Dá um nome pro tipo' }); return; }
    setSaving(true);
    try {
      const cleanFields = fields.filter((f) => f.label.trim()).map((f) => ({ label: f.label.trim(), value: '', kind: f.kind || 'text', secret: f.kind === 'password' }));
      const payload = { key: slugifyType(name), label: name, color, icon, fields: cleanFields };
      const key = onCreate ? await onCreate(payload) : (await saveType.mutateAsync(payload)).key;
      onSaved(key);
    } catch {
      showToast({ kind: 'error', title: 'Não consegui criar o tipo' });
    } finally { setSaving(false); }
  }

  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-bg-app border border-border rounded-lg w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm p-md border-b border-border shrink-0">
          <Plus size={18} className="text-tom" />
          <h3 className="text-body-lg font-semibold text-fg flex-1">Novo tipo de ficha</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-md space-y-md">
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Nome</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Fornecedor" className={inputCls} autoFocus />
          </div>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Cor</div>
            <div className="flex flex-wrap gap-xs">
              {NOTE_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setColor(c)} className="w-6 h-6 rounded-full focus-ring shrink-0"
                  style={{ background: c, outline: color === c ? '2px solid var(--color-fg, currentColor)' : 'none', outlineOffset: 2 }} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Ícone</div>
            <div className="flex flex-wrap gap-xs">
              {NOTE_ICONS.map((ic) => (
                <button key={ic} type="button" aria-label={ic} onClick={() => setIcon(ic)}
                  className={`grid place-items-center w-8 h-8 rounded-md border shrink-0 ${icon === ic ? 'border-tom text-tom' : 'border-border text-fg-muted'}`}>
                  <NoteGlyph name={ic} size={16} color={icon === ic ? color : undefined} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Campos do modelo</div>
            <div className="space-y-xs">
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-xs">
                  <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Rótulo do campo"
                    className="flex-1 min-w-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
                  <select value={f.kind || 'text'} onChange={(e) => setField(i, { kind: e.target.value as FieldKind })}
                    className="shrink-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom">
                    {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeField(i)} aria-label="Remover campo" className="text-fg-muted hover:text-danger p-1 shrink-0 focus-ring rounded-sm"><X size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addField} className="inline-flex items-center gap-1 text-body-sm text-tom mt-xs focus-ring rounded-sm"><Plus size={14} /> Adicionar campo</button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-sm p-md border-t border-border shrink-0">
          <Button variant="secondary" size="md" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="md" onClick={save} loading={saving}>Criar tipo</Button>
        </div>
      </div>
    </div>
  );
}
