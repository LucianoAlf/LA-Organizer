// Gestão dos Modelos de tarefa PESSOAIS ("Meus modelos") — abre de dentro do
// TaskTemplatePicker. Só o dono vê (RLS); sem editor campo-a-campo: pra mudar o
// conteúdo, aplica → ajusta no formulário → "Atualizar com o formulário atual"
// (decisão anti-trambolho da spec 2026-07-07). Demanda Jonathan ADM 07/07.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { showToast } from './Toast';
import {
  KIND_LABEL, deleteTaskTemplate, isDupName, isSnapshotEmpty, listMyTemplates,
  normalizeTemplateName, payloadFromSnapshot, updateTaskTemplate,
  type TaskTemplate, type TemplateKind,
} from '../lib/taskTemplates';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Aba ativa do QuickCreateSheet — gate do "Atualizar com o formulário atual". */
  activeKind: TemplateKind;
  /** Snapshot cru da aba ativa (QuickCreateSheet.buildSnapshot). */
  getSnapshot: () => Record<string, unknown>;
}

export function TaskTemplatesSheet({ open, onClose, activeKind, getSnapshot }: Props) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['task-templates'], queryFn: listMyTemplates, enabled: open });
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<TaskTemplate | null>(null);
  const [confirmUpd, setConfirmUpd] = useState<TaskTemplate | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['task-templates'] });

  const renomear = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(renaming?.name ?? '');
      if (!n) throw new Error('nome_invalido');
      await updateTaskTemplate(renaming!.id, { name: n });
    },
    onSuccess: () => { invalidate(); setRenaming(null); showToast({ kind: 'success', title: 'Modelo renomeado' }); },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : isDupName(e) ? 'Já existe um modelo seu com esse nome.' : 'Não consegui renomear.',
    }),
  });

  const atualizar = useMutation({
    mutationFn: async (t: TaskTemplate) => {
      const payload = payloadFromSnapshot(activeKind, getSnapshot());
      if (isSnapshotEmpty(payload)) throw new Error('form_vazio');
      await updateTaskTemplate(t.id, { payload });
    },
    onSuccess: () => { invalidate(); setConfirmUpd(null); showToast({ kind: 'success', title: 'Modelo atualizado com o formulário atual' }); },
    onError: (e: Error) => {
      setConfirmUpd(null);
      showToast({
        kind: 'error',
        title: e.message === 'form_vazio' ? 'Preenche o formulário antes de atualizar o modelo.' : 'Não consegui atualizar.',
      });
    },
  });

  const excluir = useMutation({
    mutationFn: (id: string) => deleteTaskTemplate(id),
    onSuccess: () => { invalidate(); setConfirmDel(null); showToast({ kind: 'success', title: 'Modelo excluído' }); },
    onError: () => showToast({ kind: 'error', title: 'Não consegui excluir.' }),
  });

  return (
    <AdaptiveSheet open={open} onClose={onClose} title="Meus modelos" size="sm">
      <div className="space-y-2">
        <p className="text-body-sm text-fg-muted">
          Modelos pessoais — só você vê. Pra mudar o conteúdo: aplica o modelo, ajusta o formulário e usa ↻.
        </p>
        {(templates.data ?? []).map((t) => (
          <div key={t.id} className="rounded-md border border-border bg-bg-elevated px-3 py-2">
            {renaming?.id === t.id ? (
              <div className="flex items-center gap-2">
                <input value={renaming.name} onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                  maxLength={80} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renomear.mutate(); } if (e.key === 'Escape') setRenaming(null); }}
                  className="flex-1 bg-bg-surface border border-border rounded-md p-1.5 text-fg text-body-sm focus:outline-none focus:border-tom" />
                <Button variant="primary" size="sm" disabled={renomear.isPending} onClick={() => renomear.mutate()}>Salvar</Button>
                <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>Cancelar</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-body-md text-fg truncate">{t.name}</span>
                    <span className="shrink-0 text-caption text-tom border border-tom/40 rounded-full px-2 py-0.5">{KIND_LABEL[t.kind]}</span>
                  </div>
                  {typeof t.payload.title === 'string' && t.payload.title && (
                    <div className="text-caption text-fg-muted truncate">{t.payload.title}</div>
                  )}
                </div>
                <button type="button" aria-label={`Renomear ${t.name}`} onClick={() => setRenaming({ id: t.id, name: t.name })}
                  className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-tom focus-ring"><Pencil size={15} /></button>
                <button type="button" aria-label={`Atualizar ${t.name} com o formulário atual`}
                  disabled={t.kind !== activeKind}
                  title={t.kind !== activeKind ? `Só na aba ${KIND_LABEL[t.kind]}` : 'Atualizar com o formulário atual'}
                  onClick={() => setConfirmUpd(t)}
                  className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-tom disabled:opacity-30 focus-ring"><RefreshCw size={15} /></button>
                <button type="button" aria-label={`Excluir ${t.name}`} onClick={() => setConfirmDel(t)}
                  className="shrink-0 p-1.5 rounded-sm text-fg-muted hover:text-danger focus-ring"><Trash2 size={15} /></button>
              </div>
            )}
          </div>
        ))}
        {templates.data && templates.data.length === 0 && (
          <p className="text-body-sm text-fg-muted">Nenhum modelo seu ainda — salva um pelo link "salvar como modelo" do formulário.</p>
        )}
      </div>

      <ConfirmDialog open={!!confirmUpd} title={`Sobrescrever "${confirmUpd?.name}"?`}
        description="O conteúdo do modelo vira o que está no formulário agora. Não dá pra desfazer."
        confirmLabel="Atualizar" isPending={atualizar.isPending}
        onConfirm={() => confirmUpd && atualizar.mutate(confirmUpd)} onClose={() => setConfirmUpd(null)} />
      <ConfirmDialog open={!!confirmDel} title={`Excluir "${confirmDel?.name}"?`}
        description="Tarefas já criadas com esse modelo não mudam. Não dá pra desfazer."
        confirmLabel="Excluir" confirmVariant="danger" isPending={excluir.isPending}
        onConfirm={() => confirmDel && excluir.mutate(confirmDel.id)} onClose={() => setConfirmDel(null)} />
    </AdaptiveSheet>
  );
}
