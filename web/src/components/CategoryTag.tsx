import { useState } from 'react';
import { PROJECT_CATEGORY_LABELS } from '../lib/projectLabels';
import type { Project } from '../types';

// Sprint 22 Phase A — paleta única de categoria. Antes vivia inline em TaskRow,
// ProjectCard e Semana. Agora qualquer tela importa daqui — sem duplicação.
// Spec: docs/design-system.md §1.2.
//
// Sprint 22.21f — quando recebe onChange, vira tag clicavel que abre dropdown
// inline pra trocar categoria. Mesmo padrao visual do RowMenu (z-50, shadow).
const CATEGORY_TAG: Record<Project['category'], string> = {
  pedagogical:    'bg-[#8B5CF6]/15 text-[#C4B5FD]',
  commercial:     'bg-[#D946EF]/15 text-[#F0ABFC]',
  administrative: 'bg-[#06B6D4]/15 text-[#A5F3FC]',
  operational:    'bg-[#14B8A6]/15 text-[#99F6E4]',
  event:          'bg-[#F43F5E]/15 text-[#FECDD3]',
  infrastructure: 'bg-[#64748B]/20 text-[#CBD5E1]',
};

const CATEGORY_ORDER: Project['category'][] = [
  'pedagogical', 'commercial', 'administrative', 'operational', 'event', 'infrastructure',
];

interface ProjectLite {
  name: string;
  category?: Project['category'] | string | null;
}

interface Props {
  project?: ProjectLite | null;
  /** Sobrescreve o nome exibido (ex: mostrar nome curto). */
  label?: string;
  className?: string;
  /** Quando passado, vira botao clicavel com dropdown de categorias. */
  onChange?: (category: Project['category']) => void;
}

export function CategoryTag({ project, label, className, onChange }: Props) {
  const [open, setOpen] = useState(false);
  if (!project?.name && !label) return null;
  const cat = project?.category as Project['category'] | undefined;
  const cls = (cat && CATEGORY_TAG[cat]) ?? 'bg-bg-elevated text-fg-muted border border-border';
  const baseClass = ['inline-block text-[10px] font-normal lowercase rounded-sm px-1.5 py-0.5', cls, className ?? ''].join(' ');

  // Modo somente-leitura (default)
  if (!onChange) {
    return <span className={baseClass}>{label ?? project!.name}</span>;
  }

  // Modo editavel — wrapper relativo + dropdown
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setTimeout(() => setOpen(false), 150);
    }
  }

  function pick(c: Project['category']) {
    if (c !== cat) onChange!(c);
    setOpen(false);
  }

  return (
    <div className="relative inline-block" data-no-nav onBlur={handleBlur}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={[baseClass, 'cursor-pointer hover:opacity-80 focus-ring'].join(' ')}
      >
        {label ?? project!.name}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {CATEGORY_ORDER.map(c => {
            const optCls = CATEGORY_TAG[c];
            const selected = c === cat;
            return (
              <button
                key={c}
                type="button"
                onClick={(e) => { e.stopPropagation(); pick(c); }}
                className={[
                  'w-full px-3 py-2 text-left text-body-sm flex items-center gap-2',
                  selected ? 'bg-bg-elevated' : 'hover:bg-bg-elevated',
                ].join(' ')}
              >
                <span className={['inline-block text-[10px] font-normal lowercase rounded-sm px-1.5 py-0.5', optCls].join(' ')}>
                  {PROJECT_CATEGORY_LABELS[c]}
                </span>
                {selected && <span className="ml-auto text-fg-muted text-body-sm">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
