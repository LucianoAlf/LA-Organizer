// Sprint 23 — Drawer de edição de template (form completo, sem DnD nesta sprint)

import { useState, useEffect } from 'react';
import {
  useTemplates,
  useTemplateItems,
  type OpChecklist,
} from './hooks/useTemplates';

interface Props {
  templateId: string;
  onClose: () => void;
}

const DAYS = [
  { v: 1, label: 'Dom' },
  { v: 2, label: 'Seg' },
  { v: 3, label: 'Ter' },
  { v: 4, label: 'Qua' },
  { v: 5, label: 'Qui' },
  { v: 6, label: 'Sex' },
  { v: 7, label: 'Sáb' },
];

export function TemplateEditDrawer({ templateId, onClose }: Props) {
  const { list, update } = useTemplates();
  const tpl = (list.data || []).find((t) => t.id === templateId);
  const { list: items, addItem, updateItem, deleteItem } = useTemplateItems(templateId);

  const [form, setForm] = useState<Partial<OpChecklist>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (tpl) {
      setForm({
        name: tpl.name,
        dispatch_time: tpl.dispatch_time,
        function_role: tpl.function_role,
        unit: tpl.unit,
        completion_threshold: tpl.completion_threshold,
        days_of_week: tpl.days_of_week ?? [],
      });
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tpl?.id,
    tpl?.name,
    tpl?.dispatch_time,
    tpl?.function_role,
    tpl?.unit,
    tpl?.completion_threshold,
  ]);

  if (!tpl) {
    return <div className="p-8 text-fg/40">Template não encontrado.</div>;
  }

  const setField = <K extends keyof OpChecklist>(
    k: K,
    v: OpChecklist[K] | null
  ) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const handleSave = () => {
    update.mutate(
      { id: templateId, patch: form },
      {
        onSuccess: () => setDirty(false),
        onError: (e: Error) => alert(`Erro: ${e.message}`),
      }
    );
  };

  const toggleDay = (d: number) => {
    const days = form.days_of_week ?? [];
    const next = days.includes(d)
      ? days.filter((x: number) => x !== d)
      : [...days, d].sort();
    setField('days_of_week', next);
  };

  const handleAddItem = () => {
    const txt = prompt('Descrição do item:');
    if (txt?.trim()) addItem.mutate(txt.trim());
  };

  return (
    <div className="flex flex-col h-full">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-fg font-semibold truncate">Editar template</h2>
        <button
          onClick={onClose}
          className="text-fg/60 hover:text-fg text-lg"
          aria-label="Fechar"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <Field label="Nome">
          <input
            value={form.name ?? ''}
            onChange={(e) => setField('name', e.target.value)}
            className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Horário">
            <input
              type="time"
              value={form.dispatch_time?.slice(0, 5) ?? ''}
              onChange={(e) =>
                setField('dispatch_time', e.target.value || null)
              }
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
          <Field label="Threshold (%)">
            <input
              type="number"
              min={1}
              max={100}
              value={form.completion_threshold ?? 100}
              onChange={(e) =>
                setField('completion_threshold', parseInt(e.target.value, 10))
              }
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
        </div>

        <Field label="Dias da semana">
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d) => (
              <button
                key={d.v}
                onClick={() => toggleDay(d.v)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                  (form.days_of_week ?? []).includes(d.v)
                    ? 'bg-tom text-bg-app'
                    : 'bg-bg-app text-fg/60 border border-border hover:text-fg'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Função">
            <input
              value={form.function_role ?? ''}
              onChange={(e) => setField('function_role', e.target.value)}
              placeholder="ex: secretary_morning"
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
          <Field label="Unidade">
            <input
              value={form.unit ?? ''}
              onChange={(e) => setField('unit', e.target.value)}
              placeholder="all | campo_grande | recreio"
              className="w-full bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
            />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-fg/60 uppercase tracking-wider">
              Itens ({(items.data || []).length})
            </span>
            <button
              onClick={handleAddItem}
              className="text-xs text-tom hover:underline"
            >
              + Item
            </button>
          </div>
          <ul className="space-y-1">
            {(items.data || []).map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-2 bg-bg-app border border-border rounded-md p-2"
              >
                <span className="text-fg/40 text-xs w-5">{it.sort_order}.</span>
                <input
                  defaultValue={it.description}
                  onBlur={(e) => {
                    if (e.target.value !== it.description) {
                      updateItem.mutate({ id: it.id, description: e.target.value });
                    }
                  }}
                  className="flex-1 bg-transparent text-sm text-fg focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (confirm('Remover item?')) deleteItem.mutate(it.id);
                  }}
                  className="text-fg/40 hover:text-danger text-xs px-1"
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="border-t border-border p-3 flex items-center gap-2">
        {dirty && <span className="text-xs text-fg/60">Não salvo</span>}
        <button
          onClick={handleSave}
          disabled={!dirty || update.isPending}
          className="ml-auto text-xs px-4 py-2 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
        >
          {update.isPending ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </footer>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-fg/60 uppercase tracking-wider mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
