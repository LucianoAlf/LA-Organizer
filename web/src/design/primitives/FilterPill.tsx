import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface FilterPillProps {
  label: string;
  value?: ReactNode;
  count?: number;
  active?: boolean;
  hasDropdown?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export function FilterPill({
  label,
  value,
  count,
  active = false,
  hasDropdown = false,
  onClick,
  disabled = false,
}: FilterPillProps) {
  const base = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] font-medium transition-colors focus-ring';
  const state = disabled
    ? 'bg-bg-elevated border-border text-fg-muted opacity-50 cursor-not-allowed'
    : active
      ? 'bg-tom/10 border-tom/40 text-tom hover:bg-tom/15'
      : 'bg-bg-elevated border-border text-fg-secondary hover:border-border/80 hover:text-fg';

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${state}`}>
      <span>{label}</span>
      {value !== undefined && (
        <>
          <span className="text-fg-muted">·</span>
          <span className={active ? 'text-tom font-semibold' : 'text-fg font-semibold'}>{value}</span>
        </>
      )}
      {count !== undefined && count > 0 && (
        <span className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold grid place-items-center ${active ? 'bg-tom text-white' : 'bg-bg-elevated2 text-fg'}`}>
          {count}
        </span>
      )}
      {hasDropdown && <ChevronDown size={12} className="opacity-60" />}
    </button>
  );
}
