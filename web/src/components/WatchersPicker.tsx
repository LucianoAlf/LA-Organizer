// web/src/components/WatchersPicker.tsx
// Multi-seleção de pessoas "em cópia". Fonte: TODOS os ativos (não a equipe).
// Adicionar via CustomSelect; remover clicando no X do chip.
import { useMemo } from 'react';
import { useActiveCollaborators } from '../hooks/useActiveCollaborators';
import { CustomSelect } from './CustomSelect';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  excludeIds?: string[];
  enabled?: boolean;
}

export function WatchersPicker({ value, onChange, excludeIds = [], enabled = true }: Props) {
  const q = useActiveCollaborators(enabled);
  const all = q.data ?? [];
  const nameById = useMemo(() => new Map(all.map(c => [c.id, c.full_name])), [all]);
  const excluded = new Set([...excludeIds, ...value]);
  const options = all
    .filter(c => !excluded.has(c.id))
    .map(c => ({ value: c.id, label: c.full_name, sublabel: c.role }));

  return (
    <div>
      <CustomSelect
        value=""
        placeholder={q.isLoading ? 'Carregando…' : '— Adicionar quem fica em cópia —'}
        onChange={(id) => { if (id && !value.includes(id)) onChange([...value, id]); }}
        options={options}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {value.map(id => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-bg-elevated border border-border px-2.5 py-1 text-body-sm text-fg">
              {nameById.get(id) ?? 'Pessoa'}
              <button type="button" aria-label="Remover"
                className="text-fg-muted hover:text-danger leading-none"
                onClick={() => onChange(value.filter(v => v !== id))}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
