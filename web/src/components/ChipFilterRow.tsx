import type { ReactNode, CSSProperties } from 'react';

export interface ChipItem {
  id: string;
  label: ReactNode;
  count?: number;
}

interface Props {
  items: ChipItem[];
  activeId: string;
  onChange: (id: string) => void;
  extra?: ReactNode;
}

export function ChipFilterRow({ items, activeId, onChange, extra }: Props) {
  return (
    <>
      <style>{`.chip-row-scroll::-webkit-scrollbar{display:none}`}</style>
      <div
        className="flex gap-2 overflow-x-auto py-2 chip-row-scroll"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', minHeight: 44 } as CSSProperties}
      >
        {items.map(it => {
          const active = it.id === activeId;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange(it.id)}
              className={[
                'whitespace-nowrap rounded-full px-3 py-1.5 text-body-sm border transition-colors',
                active
                  ? 'bg-tom text-bg-app border-tom font-semibold'
                  : 'bg-bg-surface text-fg-muted border-border hover:border-tom/50',
              ].join(' ')}
            >
              {it.label}
              {it.count != null && (
                <span className={[
                  'ml-1.5 rounded-md px-1.5 py-0.5 text-[10px]',
                  active ? 'bg-black/20' : 'bg-bg-app',
                ].join(' ')}>{it.count}</span>
              )}
            </button>
          );
        })}
        {extra}
      </div>
    </>
  );
}
