import { useState } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import { NOTE_COLORS, NOTE_ICONS, slugifyType, type NoteField, type FieldKind } from '../../../lib/groupNotes';
import { useGroupNoteTypes } from '../../../hooks/useGroupNoteTypes';
import { CustomSelect } from '../../../components/CustomSelect';
import { NoteGlyph } from './IconRegistry';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { showToast } from '../../../components/Toast';

const KINDS: { value: FieldKind; label: string }[] = [
  { value: 'text', label: 'Texto' }, { value: 'password', label: 'Senha' }, { value: 'url', label: 'Link' },
];

export interface EditingType { id?: string; key: string; label: string; color: string | null; icon: string | null; fields: NoteField[] }

// Cria OU edita um tipo de ficha custom (nome + cor + ícone + campos do modelo).
// Grupo: passa groupId (usa useGroupNoteTypes). Pessoal: passa onSaveType/onDeleteType.
// editing → modo edição (form preenchido) + botão Excluir. A KEY não muda ao editar
// (senão as fichas que usam o tipo ficariam órfãs).
export function NoteTypeForm({ groupId, editing, onSaved, onClose, onDeleted, onSaveType, onDeleteType }: {
  groupId?: string; editing?: EditingType | null;
  onSaved: (key: string) => void; onClose: () => void; onDeleted?: () => void;
  onSaveType?: (t: { id?: string; key: string; label: string; color: string; icon: string; fields: NoteField[] }) => Promise<string>;
  onDeleteType?: (id: string) => Promise<void>;
}) {
  const { saveType, removeType } = useGroupNoteTypes(groupId ?? '');
  const isEdit = !!(editing && editing.id);
  const [label, setLabel] = useState(editing?.label || '');
  const [color, setColor] = useState<string>(editing?.color || NOTE_COLORS[5]);
  const [icon, setIcon] = useState<string>(editing?.icon || 'FileText');
  const [fields, setFields] = useState<NoteField[]>(
    editing?.fields && editing.fields.length ? editing.fields.map((f) => ({ ...f })) : [{ label: '', value: '', kind: 'text' }],
  );
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  function setField(i: number, p: Partial<NoteField>) { setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...p } : f))); }
  function addField() { setFields((fs) => [...fs, { label: '', value: '', kind: 'text' }]); }
  function removeField(i: number) { setFields((fs) => fs.filter((_, idx) => idx !== i)); }

  async function save() {
    const name = label.trim();
    if (!name) { showToast({ kind: 'error', title: 'Dá um nome pro tipo' }); return; }
    setSaving(true);
    try {
      const cleanFields = fields.filter((f) => f.label.trim()).map((f) => ({ label: f.label.trim(), value: '', kind: f.kind || 'text', secret: f.kind === 'password' }));
      const key = isEdit ? editing!.key : slugifyType(name); // edição: mantém a key
      const payload = { id: editing?.id, key, label: name, color, icon, fields: cleanFields };
      const savedKey = onSaveType ? await onSaveType(payload) : (await saveType.mutateAsync(payload)).key;
      onSaved(savedKey);
    } catch {
      showToast({ kind: 'error', title: isEdit ? 'Não consegui salvar o tipo' : 'Não consegui criar o tipo' });
    } finally { setSaving(false); }
  }

  async function excluir() {
    if (!editing?.id) return;
    setRemoving(true);
    try {
      if (onDeleteType) await onDeleteType(editing.id); else await removeType.mutateAsync(editing.id);
      onDeleted?.();
      onClose();
    } catch {
      showToast({ kind: 'error', title: 'Não consegui excluir o tipo' });
    } finally { setRemoving(false); }
  }

  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-bg-app border border-border rounded-lg w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm p-md border-b border-border shrink-0">
          {isEdit ? <Pencil size={18} className="text-tom" /> : <Plus size={18} className="text-tom" />}
          <h3 className="text-body-lg font-semibold text-fg flex-1">{isEdit ? 'Editar tipo de ficha' : 'Novo tipo de ficha'}</h3>
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
                  <div className="w-28 shrink-0">
                    <CustomSelect value={f.kind || 'text'} options={KINDS} onChange={(v) => setField(i, { kind: v as FieldKind })} size="sm" />
                  </div>
                  <button type="button" onClick={() => removeField(i)} aria-label="Remover campo" className="text-fg-muted hover:text-danger p-1 shrink-0 focus-ring rounded-sm"><X size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addField} className="inline-flex items-center gap-1 text-body-sm text-tom mt-xs focus-ring rounded-sm"><Plus size={14} /> Adicionar campo</button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-sm p-md border-t border-border shrink-0">
          {isEdit
            ? <Button variant="ghost" size="md" onClick={() => setConfirmDel(true)} leadingIcon={<Trash2 size={15} />}>Excluir</Button>
            : <span />}
          <div className="flex items-center gap-sm">
            <Button variant="secondary" size="md" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" size="md" onClick={save} loading={saving}>{isEdit ? 'Salvar' : 'Criar tipo'}</Button>
          </div>
        </div>
      </div>
    </div>
    <ConfirmDialog open={confirmDel} title={`Excluir o tipo "${editing?.label || ''}"?`} description="Não dá pra desfazer." confirmLabel="Excluir" confirmVariant="danger"
      isPending={removing} onConfirm={excluir} onClose={() => setConfirmDel(false)} />
    </>
  );
}
