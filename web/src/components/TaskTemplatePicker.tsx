// "Meus modelos" do QuickCreateSheet — demanda Jonathan ADM 07/07.
// UX (feedback Alf 07/07): CARREGAR e SALVAR são momentos diferentes do fluxo,
// então vivem em lugares diferentes. O select fica no topo (escolhe o modelo
// ANTES de preencher); o "salvar como modelo" fica no rodapé, junto do Criar
// (salva DEPOIS de preencher) e abre um mini-sheet próprio pro nome — nada se
// intromete entre os campos do formulário. Aplicar NUNCA cria nada.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
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

export function TaskTemplatePicker({ kind, getSnapshot, onPick }: {
  kind: TemplateKind;
  getSnapshot: () => Record<string, unknown>;
  onPick: (t: TaskTemplate) => void;
}) {
  const templates = useQuery({ queryKey: ['task-templates'], queryFn: listMyTemplates, staleTime: 5 * 60_000 });
  const doKind = (templates.data ?? []).filter((t) => t.kind === kind);
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="mb-md max-w-[280px]">
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
      <TaskTemplatesSheet open={manageOpen} onClose={() => setManageOpen(false)} activeKind={kind} getSnapshot={getSnapshot} />
    </div>
  );
}

// Link do rodapé (acima do Criar) + mini-sheet de nome. Fica junto do botão de
// ação porque age sobre o FORMULÁRIO INTEIRO, não sobre um campo.
export function SaveAsTemplateLink({ kind, getSnapshot }: {
  kind: TemplateKind;
  getSnapshot: () => Record<string, unknown>;
}) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const salvar = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(name);
      if (!n) throw new Error('nome_invalido');
      const payload = payloadFromSnapshot(kind, getSnapshot());
      if (isSnapshotEmpty(payload)) throw new Error('form_vazio');
      await createTaskTemplate(n, kind, payload, collaborator!.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-templates'] });
      setOpen(false);
      showToast({ kind: 'success', title: 'Modelo salvo — só você vê.', msg: 'Fica no menu "Meus modelos…" desta aba.' });
    },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : e.message === 'form_vazio' ? 'Preenche o formulário antes de salvar como modelo.'
        : isDupName(e) ? 'Já existe um modelo seu com esse nome.' : 'Não consegui salvar o modelo.',
    }),
  });

  return (
    <>
      <div className="flex justify-end">
        <button type="button" onClick={() => { setName(''); setOpen(true); }}
          className="text-body-sm text-fg-muted hover:text-tom underline underline-offset-2 focus-ring rounded">
          salvar como modelo
        </button>
      </div>
      <AdaptiveSheet open={open} onClose={() => setOpen(false)} title="Salvar como modelo" size="sm">
        <div className="space-y-3">
          <p className="text-body-sm text-fg-muted">
            Guarda o formulário preenchido como atalho no menu "Meus modelos…". Só você vê.
          </p>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); salvar.mutate(); } }}
            placeholder="Nome do atalho (ex.: Contato Lead Kids)"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-md focus:outline-none focus:border-tom" />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary" size="md" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      </AdaptiveSheet>
    </>
  );
}
