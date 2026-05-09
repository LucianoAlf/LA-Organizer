import { ReactNode } from 'react';

interface Tab<T extends string> {
  id: T;
  label: string;
  badge?: ReactNode;
}

interface Props<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string>({ tabs, active, onChange, className = '' }: Props<T>) {
  return (
    // Sprint 11.4 hotfix — Tabs sem scroll horizontal.
    // Antes: `overflow-x-auto` + `whitespace-nowrap` → scroll lateral em mobile.
    // Depois: `flex-wrap` deixa pílulas quebrarem pra próxima linha quando não cabem.
    // Padding e font reduzidos pra caber 4 pills em telas estreitas (~360px).
    // Aplicado globalmente — afeta Hoje (2 tabs) e ProjetoDetalhe (4 tabs).
    <div
      role="tablist"
      className={[
        'flex flex-wrap gap-1',
        className,
      ].join(' ')}
    >
      {tabs.map(t => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={[
              'h-8 px-2.5 rounded-md inline-flex items-center gap-1 focus-ring transition-colors whitespace-nowrap',
              isActive
                ? 'bg-tom text-black shadow-card dark:shadow-none'
                : 'bg-bg-subtle text-fg-muted border border-border hover:text-fg',
            ].join(' ')}
          >
            <span className="text-body-sm font-semibold">{t.label}</span>
            {t.badge != null && (
              <span className={[
                'text-body-sm font-semibold',
                isActive ? 'text-black/60' : 'text-fg-muted/70',
              ].join(' ')}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
