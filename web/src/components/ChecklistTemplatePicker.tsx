// Linha "Usar modelo…" da seção CHECKLIST do QuickCreateSheet + "salvar como modelo".
// O picker APLICA itens no rascunho (applyTemplate: append sem duplicar); os itens
// continuam editáveis antes de criar. Sentinel __manage__ abre o CRUD (sheet).
// Demanda Jonathan ADM 06/07 — modelos compartilhados no time.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CustomSelect } from './CustomSelect';
import { showToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import { ChecklistTemplatesSheet } from './ChecklistTemplatesSheet';
import {
  listTemplates, createTemplate, applyTemplate, normalizeTemplateName, isDupName,
} from '../lib/checklistTemplates';

const MANAGE = '__manage__';

export function ChecklistTemplatePicker({ items, onChange }: { items: string[]; onChange: (next: string[]) => void }) {
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['checklist-templates'], queryFn: listTemplates, staleTime: 5 * 60_000 });
  const [manageOpen, setManageOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null); // null = fechado

  const salvarModelo = useMutation({
    mutationFn: async () => {
      const n = normalizeTemplateName(savingName ?? '');
      if (!n) throw new Error('nome_invalido');
      await createTemplate(n, items.map((s) => s.trim()).filter(Boolean), collaborator!.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist-templates'] });
      setSavingName(null);
      showToast({ kind: 'success', title: 'Modelo salvo', msg: 'Já disponível pra todo o time.' });
    },
    onError: (e: Error) => showToast({
      kind: 'error',
      title: e.message === 'nome_invalido' ? 'Nome precisa ter de 2 a 80 letras.'
        : isDupName(e) ? 'Já existe um modelo com esse nome.' : 'Não consegui salvar o modelo.',
    }),
  });

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px] max-w-[280px]">
          <CustomSelect
            value=""
            placeholder="Usar modelo…"
            size="sm"
            options={[
              ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name, sublabel: `${t.items.length} itens` })),
              { value: MANAGE, label: '⚙️ Gerenciar modelos…', sublabel: 'criar / editar / excluir' },
            ]}
            onChange={(v) => {
              if (v === MANAGE) { setManageOpen(true); return; }
              const t = (templates.data ?? []).find((x) => x.id === v);
              if (t) onChange(applyTemplate(items, t.items));
            }}
          />
        </div>
        {items.length > 0 && savingName === null && (
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
            placeholder="Nome do modelo (ex.: ADM — Experimental)"
            className="flex-1 bg-bg-surface border border-border rounded-md p-2 text-fg text-body-sm focus:outline-none focus:border-tom" />
          <button type="button" disabled={salvarModelo.isPending} onClick={() => salvarModelo.mutate()}
            className="shrink-0 text-body-sm text-black bg-tom font-medium px-3 py-1.5 rounded-md disabled:opacity-40 focus-ring">Salvar</button>
          <button type="button" onClick={() => setSavingName(null)}
            className="shrink-0 text-body-sm text-fg-muted focus-ring rounded px-1">Cancelar</button>
        </div>
      )}
      <ChecklistTemplatesSheet open={manageOpen} onClose={() => setManageOpen(false)} />
    </div>
  );
}
