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
    <div
      role="tablist"
      className={[
        'flex gap-2 overflow-x-auto -mx-md px-md no-scrollbar',
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
              'h-9 px-3 rounded-md inline-flex items-center gap-2 whitespace-nowrap focus-ring transition-colors',
              isActive
                ? 'bg-brand text-white shadow-card dark:shadow-none'
                : 'bg-bg-subtle text-fg-muted border border-border hover:text-fg',
            ].join(' ')}
          >
            <span className="text-body-sm font-semibold">{t.label}</span>
            {t.badge != null && (
              <span className={[
                'text-label px-1.5 rounded-sm tabular-nums',
                isActive ? 'bg-white/20' : 'bg-bg-elevated dark:bg-bg-elevated',
              ].join(' ')}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
