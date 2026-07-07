// Picker "Meus modelos…" do QuickCreateSheet — logo abaixo das 4 abas, filtrado
// pela aba ativa. Aplicar NUNCA cria nada: só preenche o formulário (o usuário
// revisa e clica Criar). Modelos pessoais, RLS só-dono. Demanda Jonathan ADM 07/07.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CustomSelect } from './CustomSelect';
import { showToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import { TaskTemplatesSheet } from './TaskTemplatesSheet';
import {
  createTaskTemplate, isDupName, isSnapshotEmpty, listMyTemplates,
  normalizeTemplateName, payloadFromSnapshot,
  type TaskTemplate, type TemplateKind,
} from '../lib/taskTemplates';

const MANAGE = '__manage__';

interface Props {
  kind: TemplateKind;
  getSnapshot: () => Record<string, unknown>;
  onPick: (t: TaskTemplate) => void;
}

export function TaskTemplatePicker({ kind, getSnapshot, onPick }: Props) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['task-templates'], queryFn: listMyTemplates, staleTime: 5 * 60_000 });
  const doKind = (templates.data ?? []).filter((t) => t.kind === kind);
  const [manageOpen, setManageOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null); // null = fechado

  const salvarModelo = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(savingName ?? '');
      if (!n) throw new Error('nome_invalido');
      const payload = payloadFromSnapshot(kind, getSnapshot());
      if (isSnapshotEmpty(payload)) throw new Error('form_vazio');
      await createTaskTemplate(n, kind, payload, collaborator!.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-templates'] });
      setSavingName(null);
      showToast({ kind: 'success', title: 'Modelo salvo — só você vê.' });
    },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : e.message === 'form_vazio' ? 'Preenche o formulário antes de salvar como modelo.'
        : isDupName(e) ? 'Já existe um modelo seu com esse nome.' : 'Não consegui salvar o modelo.',
    }),
  });

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px] max-w-[280px]">
          <CustomSelect
            value=""
            placeholder="Meus modelos…"
            size="sm"
            options={[
              ...doKind.map((t) => ({
                value: t.id, label: t.name,
                sublabel: typeof t.payload.title === 'string' ? t.payload.title : undefined,
              })),
              { value: MANAGE, label: '⚙️ Gerenciar meus modelos…', sublabel: doKind.length === 0 ? 'nenhum modelo seu nesta aba ainda' : 'renomear / atualizar / excluir' },
            ]}
            onChange={(v) => {
              if (v === MANAGE) { setManageOpen(true); return; }
              const t = doKind.find((x) => x.id === v);
              if (t) onPick(t);
            }}
          />
        </div>
        {savingName === null && (
          <button type="button" onClick={() => setSavingName('')}
            className="text-body-sm text-tom underline underline-offset-2 focus-ring rounded">
            salvar como modelo
          </button>
        )}
      </div>
      {savingName !== null && (
        <div className="flex items-center gap-2 mt-2">
          <input value={savingName} onChange={(e) => setSavingName(e.target.value)} maxLength={80} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); salvarModelo.mutate(); } if (e.key === 'Escape') setSavingName(null); }}
            placeholder="Nome do modelo (ex.: Novo Lead)"
            className="flex-1 bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom" />
          <button type="button" disabled={salvarModelo.isPending} onClick={() => salvarModelo.mutate()}
            className="shrink-0 text-body-sm text-black bg-tom font-medium px-3 py-1.5 rounded-md disabled:opacity-40 focus-ring">Salvar</button>
          <button type="button" onClick={() => setSavingName(null)}
            className="shrink-0 text-body-sm text-fg-muted focus-ring rounded px-1">Cancelar</button>
        </div>
      )}
      <TaskTemplatesSheet open={manageOpen} onClose={() => setManageOpen(false)} activeKind={kind} getSnapshot={getSnapshot} />
    </div>
  );
}
