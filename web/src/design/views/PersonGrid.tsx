import type { ReactNode } from 'react';

export interface PersonGridItem {
  id: string;
  name: string;
  avatarUrl?: string;
  role?: string;
  status?: 'active' | 'idle' | 'offline';
  meta?: ReactNode;
}

interface PersonGridProps {
  people: PersonGridItem[];
  onPersonClick?: (person: PersonGridItem) => void;
  /** Tamanho dos cards. */
  size?: 'sm' | 'md';
}

const STATUS_COLORS = {
  active: 'bg-success',
  idle: 'bg-warning',
  offline: 'bg-fg-muted',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

export function PersonGrid({ people, onPersonClick, size = 'md' }: PersonGridProps) {
  const cardClass = size === 'sm'
    ? 'p-3 gap-2'
    : 'p-4 gap-3';
  const avatarSize = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
  const initialsSize = size === 'sm' ? 'text-[12px]' : 'text-[14px]';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {people.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={onPersonClick ? () => onPersonClick(p) : undefined}
          className={[
            'flex items-center rounded-lg border border-border bg-bg-surface transition-colors text-left',
            cardClass,
            onPersonClick ? 'hover:border-tom/40 hover:bg-bg-elevated focus-ring' : '',
          ].join(' ')}
        >
          <div className="relative shrink-0">
            <div className={`${avatarSize} rounded-full bg-bg-elevated overflow-hidden border border-border grid place-items-center`}>
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt={p.name} className="w-full h-full object-cover" />
              ) : (
                <span className={`${initialsSize} font-bold text-fg`}>{initials(p.name)}</span>
              )}
            </div>
            {p.status && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-surface ${STATUS_COLORS[p.status]}`}
                aria-label={p.status}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-fg truncate">{p.name}</div>
            {p.role && <div className="text-[11px] text-fg-muted truncate">{p.role}</div>}
            {p.meta && <div className="text-[11px] text-fg-muted truncate mt-0.5">{p.meta}</div>}
          </div>
        </button>
      ))}
    </div>
  );
}
