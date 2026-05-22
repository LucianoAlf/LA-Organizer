import type { LucideIcon } from 'lucide-react';

export interface ViewOption<T extends string = string> {
  id: T;
  label: string;
  Icon: LucideIcon;
}

interface ViewSwitcherProps<T extends string = string> {
  options: ViewOption<T>[];
  value: T;
  onChange: (id: T) => void;
  iconOnly?: boolean;
}

export function ViewSwitcher<T extends string = string>({
  options,
  value,
  onChange,
  iconOnly = false,
}: ViewSwitcherProps<T>) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-bg-elevated border border-border">
      {options.map(({ id, label, Icon }) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={[
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12px] font-medium transition-colors focus-ring',
              active
                ? 'bg-bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            <Icon size={13} />
            {!iconOnly && <span className="hidden md:inline">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
