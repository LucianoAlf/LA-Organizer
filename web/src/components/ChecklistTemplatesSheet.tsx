// Gestão de Modelos de Checklist (CRUD completo) — abre de dentro do QuickCreateSheet
// ("Gerenciar modelos…"). Team-shared; editar/excluir só criador ou coordenação
// (canManageTemplate espelha a RLS). Demanda Jonathan ADM 06/07.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X, ArrowUp, ArrowDown } from 'lucide-react';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { showToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
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
  const [items, setItems] = useState<string[]>([]);
  const [novoItem, setNovoItem] = useState('');
  const [confirmDel, setConfirmDel] = useState<ChecklistTemplate | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklist-templates'] });
  const salvar = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(name);
      if (!n) throw new Error('nome_invalido');
      const list = items.map((s) => s.trim()).filter(Boolean);
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
    setItems(t === 'new' ? [] : [...t.items]);
    setNovoItem('');
  }
  const addItem = () => { const s = novoItem.trim(); if (!s) return; setItems((p) => [...p, s]); setNovoItem(''); };
  const move = (i: number, d: -1 | 1) => setItems((p) => {
    const j = i + d; if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

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
            <div className="text-label uppercase tracking-wide text-fg-muted mb-1.5">Itens (na ordem)</div>
            <div className="space-y-1 mb-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="flex-1 min-w-0 text-body-md text-fg break-words">{it}</span>
                  <button type="button" aria-label="Subir" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 text-fg-muted hover:text-fg disabled:opacity-30 focus-ring rounded"><ArrowUp size={14} /></button>
                  <button type="button" aria-label="Descer" onClick={() => move(i, 1)} disabled={i === items.length - 1}
                    className="p-1 text-fg-muted hover:text-fg disabled:opacity-30 focus-ring rounded"><ArrowDown size={14} /></button>
                  <button type="button" aria-label="Remover item" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                    className="p-1 text-fg-muted hover:text-danger focus-ring rounded"><X size={14} /></button>
                </div>
              ))}
            </div>
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
