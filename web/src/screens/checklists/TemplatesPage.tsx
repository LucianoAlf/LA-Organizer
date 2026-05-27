// Sprint 23 — TemplatesPage: rota /checklists/templates com lista + drawer de edição

import { useState } from 'react';
import { PageShell } from '../../design/primitives/PageShell';
import { useTemplates } from './hooks/useTemplates';
import { TemplateEditDrawer } from './TemplateEditDrawer';

export function TemplatesPage() {
  const { list, create, toggleActive } = useTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleCreate = () => {
    create.mutate(
      {
        name: 'Novo template',
        completion_threshold: 100,
        days_of_week: [2, 3, 4, 5, 6], // seg-sex
      },
      {
        onSuccess: (tpl) => setSelectedId(tpl.id),
      }
    );
  };

  const templates = list.data || [];

  return (
    <PageShell
      title="Templates"
      subtitle={
        list.isLoading
          ? 'Carregando…'
          : `${templates.length} template${templates.length !== 1 ? 's' : ''}`
      }
      toolbar={
        <div className="flex items-center gap-2 w-full">
          <a href="/checklists" className="text-xs text-fg/60 hover:text-tom">
            ← Voltar
          </a>
          <button
            onClick={handleCreate}
            disabled={create.isPending}
            className="ml-auto text-xs px-3 py-1.5 bg-tom text-bg-app rounded-md font-semibold disabled:opacity-50"
          >
            + Novo template
          </button>
        </div>
      }
    >
      <div className="flex h-full overflow-hidden">
        <div className="w-1/3 min-w-[280px] max-w-md border-r border-border overflow-y-auto">
          {templates.length === 0 && !list.isLoading ? (
            <div className="p-6 text-fg/40 text-sm">
              Nenhum template ainda. Crie o primeiro com "+ Novo template".
            </div>
          ) : (
            <ul>
              {templates.map((tpl) => (
                <li key={tpl.id}>
                  <button
                    onClick={() => setSelectedId(tpl.id)}
                    className={`w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-bg-surface ${
                      selectedId === tpl.id
                        ? 'bg-bg-surface border-l-2 border-tom'
                        : ''
                    }`}
                  >
                    <ToggleSwitch
                      checked={tpl.is_active}
                      onChange={(v) =>
                        toggleActive.mutate({ id: tpl.id, isActive: v })
                      }
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          tpl.is_active ? 'text-fg' : 'text-fg/50'
                        }`}
                      >
                        {tpl.name}
                      </div>
                      <div className="text-xs text-fg/60 truncate">
                        {tpl.dispatch_time?.slice(0, 5) ?? '—'}
                        {tpl.function_role ? ` · ${tpl.function_role}` : ''}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {selectedId ? (
            <TemplateEditDrawer
              templateId={selectedId}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="p-8 text-fg/40 text-sm">
              Selecione um template à esquerda ou crie um novo.
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 mt-0.5 ${
        checked ? 'bg-tom' : 'bg-bg-app border border-border'
      }`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
          checked ? 'translate-x-4 bg-bg-app left-0.5' : 'bg-fg/40 left-0.5'
        }`}
      />
    </button>
  );
}
