interface Props {
  percentual: number;          // 0-100
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ percentual, showLabel = true, className = '' }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(percentual)));
  const cor = pct >= 80 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-danger';
  return (
    <div className={`flex items-center gap-sm ${className}`}>
      <div className="flex-1 h-2 bg-bg-app rounded-full overflow-hidden">
        <div className={`h-full ${cor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="text-body-sm font-semibold text-fg-muted min-w-[3rem] text-right">{pct}%</span>}
    </div>
  );
}
