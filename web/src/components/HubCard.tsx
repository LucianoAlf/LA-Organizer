import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  onClick: () => void;
}

export function HubCard({ icon, title, meta, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-bg-surface border border-border rounded-2xl p-md flex items-center gap-3 text-left hover:border-tom/40 transition-colors"
      style={{ minHeight: 64 }}
    >
      <div className="w-12 h-12 rounded-xl bg-tom/10 flex items-center justify-center text-2xl shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-fg font-semibold">{title}</div>
        <div className="text-fg-muted text-body-sm mt-0.5 truncate">{meta}</div>
      </div>
      <div className="text-fg-muted opacity-40 text-xl shrink-0">›</div>
    </button>
  );
}
