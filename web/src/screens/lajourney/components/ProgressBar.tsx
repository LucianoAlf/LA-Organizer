interface Props {
  percentual: number;
  className?: string;
}

export function ProgressBar({ percentual, className = '' }: Props) {
  const safe = Math.max(0, Math.min(100, percentual));
  return (
    <div className={`h-1.5 bg-border rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full bg-tom transition-all duration-300"
        style={{ width: `${safe}%` }}
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
        role="progressbar"
      />
    </div>
  );
}
