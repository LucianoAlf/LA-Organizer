// "Meus modelos" do QuickCreateSheet — demanda Jonathan ADM 07/07.
// UX v3 (Alf, 07/07): TUDO de modelo mora num lugar só — dentro do próprio menu
// "Meus modelos…" no topo: usar (toca no nome), 💾 salvar o formulário atual e
// ⚙️ gerenciar. Nada de link solto no rodapé nem input inline entre os campos
// (v1 e v2 falharam exatamente por espalhar a função pelo sheet).
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

const SAVE = '__save__';
const MANAGE = '__manage__';

export function TaskTemplatePicker({ kind, getSnapshot, onPick }: {
  kind: TemplateKind;
  getSnapshot: () => Record<string, unknown>;
  onPick: (t: TaskTemplate) => void;
}) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['task-templates'], queryFn: listMyTemplates, staleTime: 5 * 60_000 });
  const doKind = (templates.data ?? []).filter((t) => t.kind === kind);
  const [manageOpen, setManageOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
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
      setSaveOpen(false);
      showToast({ kind: 'success', title: 'Modelo salvo — só você vê.', msg: 'Fica aqui no menu "Meus modelos…".' });
    },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : e.message === 'form_vazio' ? 'Preenche o formulário antes de salvar como modelo.'
        : isDupName(e) ? 'Já existe um modelo seu com esse nome.' : 'Não consegui salvar o modelo.',
    }),
  });

  return (
    <div className="mb-md max-w-[300px]">
      <CustomSelect
        value=""
        placeholder="Meus modelos…"
        size="sm"
        options={[
          ...doKind.map((t) => ({
            value: t.id, label: t.name,
            sublabel: typeof t.payload.title === 'string' ? t.payload.title : undefined,
          })),
          { value: SAVE, label: '💾 Salvar formulário atual como modelo…', sublabel: 'preenche embaixo e salva aqui' },
          { value: MANAGE, label: '⚙️ Gerenciar meus modelos…', sublabel: doKind.length === 0 ? 'nenhum modelo seu nesta aba ainda' : 'renomear / atualizar / excluir' },
        ]}
        onChange={(v) => {
          if (v === SAVE) { setName(''); setSaveOpen(true); return; }
          if (v === MANAGE) { setManageOpen(true); return; }
          const t = doKind.find((x) => x.id === v);
          if (t) onPick(t);
        }}
      />

      <AdaptiveSheet open={saveOpen} onClose={() => setSaveOpen(false)} title="Salvar como modelo" size="sm">
        <div className="space-y-3">
          <p className="text-body-sm text-fg-muted">
            Guarda o formulário preenchido como atalho no menu "Meus modelos…". Só você vê.
          </p>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); salvar.mutate(); } }}
            placeholder="Nome do atalho (ex.: Contato Lead Kids)"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg text-body-md focus:outline-none focus:border-tom" />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button variant="primary" size="md" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      </AdaptiveSheet>

      <TaskTemplatesSheet open={manageOpen} onClose={() => setManageOpen(false)} activeKind={kind} getSnapshot={getSnapshot} />
    </div>
  );
}
