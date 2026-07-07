// Gestão de Modelos de Checklist (CRUD completo) — abre de dentro do QuickCreateSheet
// ("Gerenciar modelos…"). Team-shared; editar/excluir só criador ou coordenação
// (canManageTemplate espelha a RLS). Demanda Jonathan ADM 06/07.
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { ChecklistItemEditRow } from './ChecklistItemEditRow';
import { showToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import { useSortableSensors } from '../lib/sortableSensors';
import {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  normalizeTemplateName, canManageTemplate, isDupName, type ChecklistTemplate,
} from '../lib/checklistTemplates';

const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-md focus:outline-none focus:border-tom';

export function ChecklistTemplatesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['checklist-templates'], queryFn: listTemplates, enabled: open });

  // null = listagem; 'new' = criando; ChecklistTemplate = editando
  const [editing, setEditing] = useState<'new' | ChecklistTemplate | null>(null);
  const [name, setName] = useState('');
  // Linhas com uid estável (_lk) pro SortableContext — mesmo padrão do ChecklistTemplateSheet
  // (op_checklists): DnD por grip handle, sem setinhas.
  const [items, setItems] = useState<Array<{ _lk: string; text: string }>>([]);
  const [novoItem, setNovoItem] = useState('');
  const [confirmDel, setConfirmDel] = useState<ChecklistTemplate | null>(null);
  const lkSeq = useRef(0);
  const nextLk = () => `lk-${++lkSeq.current}`;
  const sensors = useSortableSensors();

  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklist-templates'] });
  const salvar = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(name);
      if (!n) throw new Error('nome_invalido');
      const list = items.map((r) => r.text.trim()).filter(Boolean);
      if (list.length === 0) throw new Error('sem_itens');
      if (editing === 'new') await createTemplate(n, list, collaborator!.id);
      else if (editing) await updateTemplate(editing.id, { name: n, items: list });
    },
    onSuccess: () => { invalidate(); setEditing(null); showToast({ kind: 'success', title: 'Modelo salvo' }); },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : e.message === 'sem_itens' ? 'Adiciona pelo menos um item.'
        : isDupName(e) ? 'Já existe um modelo com esse nome.' : 'Não consegui salvar. Tenta de novo.',
    }),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => { invalidate(); setConfirmDel(null); showToast({ kind: 'success', title: 'Modelo excluído' }); },
    onError: () => showToast({ kind: 'error', title: 'Não consegui excluir.' }),
  });

  function abrirEdicao(t: 'new' | ChecklistTemplate) {
    setEditing(t);
    setName(t === 'new' ? '' : t.name);
    setItems(t === 'new' ? [] : t.items.map((text) => ({ _lk: nextLk(), text })));
    setNovoItem('');
  }
  const addItem = () => { const s = novoItem.trim(); if (!s) return; setItems((p) => [...p, { _lk: nextLk(), text: s }]); setNovoItem(''); };
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIdx = prev.findIndex((r) => r._lk === active.id);
      const newIdx = prev.findIndex((r) => r._lk === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Modelos de checklist" size="sm">
      {!editing ? (
        <div className="space-y-2">
          <p className="text-body-sm text-fg-muted">Modelos do time — todo mundo vê e usa. Editar/excluir: quem criou ou coordenação.</p>
          {(templates.data ?? []).map((t) => {
            const posso = canManageTemplate(t, collaborator?.id, collaborator?.role);
            return (
              <div key={t.id} className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-body-md text-fg truncate">{t.name}</div>
                  <div className="text-caption text-fg-muted truncate">{t.items.length} itens · {t.items.slice(0, 3).join(' → ')}{t.items.length > 3 ? '…' : ''}</div>
                </div>
                <button type="button" aria-label={`Editar ${t.name}`} disabled={!posso} onClick={() => abrirEdicao(t)}
                  className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-tom disabled:opacity-30 focus-ring"><Pencil size={15} /></button>
                <button type="button" aria-label={`Excluir ${t.name}`} disabled={!posso} onClick={() => setConfirmDel(t)}
                  className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-danger disabled:opacity-30 focus-ring"><Trash2 size={15} /></button>
              </div>
            );
          })}
          {templates.data && templates.data.length === 0 && (
            <p className="text-body-sm text-fg-muted">Nenhum modelo ainda — cria o primeiro.</p>
          )}
          <Button variant="secondary" size="md" leadingIcon={<Plus size={15} />} onClick={() => abrirEdicao('new')}>Novo modelo</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Nome do modelo</div>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
              placeholder="Ex.: ADM — Aula Experimental" autoFocus className={inputCls} />
          </label>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Itens (arrasta ⋮⋮ pra ordenar)</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((r) => r._lk)} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5 mb-2">
                  {items.map((r, i) => (
                    <ChecklistItemEditRow
                      key={r._lk}
                      uid={r._lk}
                      description={r.text}
                      index={i + 1}
                      onChange={(v) => setItems((p) => p.map((x) => (x._lk === r._lk ? { ...x, text: v } : x)))}
                      onDelete={() => setItems((p) => p.filter((x) => x._lk !== r._lk))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div className="flex items-center gap-2">
              <input value={novoItem} onChange={(e) => setNovoItem(e.target.value)} maxLength={200}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                placeholder="Adicionar item…" className={inputCls} />
              <button type="button" disabled={!novoItem.trim()} onClick={addItem}
                className="shrink-0 text-tom text-body-md font-medium disabled:opacity-40 focus-ring rounded px-1">Add</button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="md" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="primary" size="md" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar modelo'}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirmDel} title={`Excluir "${confirmDel?.name}"?`}
        description="Tarefas já criadas com esse modelo não mudam. Não dá pra desfazer."
        confirmLabel="Excluir" confirmVariant="danger" isPending={excluir.isPending}
        onConfirm={() => confirmDel && excluir.mutate(confirmDel.id)} onClose={() => setConfirmDel(null)} />
    </AdaptiveSheet>
  );
}
