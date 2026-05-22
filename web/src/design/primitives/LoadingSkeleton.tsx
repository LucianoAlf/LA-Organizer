interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
  className?: string;
}

export function Skeleton({ width, height = 12, rounded = 'sm', className = '' }: SkeletonProps) {
  const radius = {
    sm: 'rounded',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];
  return (
    <div
      className={`bg-bg-elevated2 animate-pulse ${radius} ${className}`}
      style={{ width, height }}
    />
  );
}

interface SkeletonCardProps {
  lines?: number;
}

export function SkeletonCard({ lines = 2 }: SkeletonCardProps) {
  return (
    <div className="p-4 rounded-lg border border-border bg-bg-surface space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton width="60%" height={14} />
        <Skeleton width={56} height={18} rounded="md" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '40%' : '100%'} height={10} />
      ))}
      <Skeleton width="100%" height={4} rounded="full" />
    </div>
  );
}

interface SkeletonRowProps {
  cols?: number;
}

export function SkeletonRow({ cols = 4 }: SkeletonRowProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} width={`${100 / cols}%`} height={12} />
      ))}
    </div>
  );
}

interface SkeletonListProps {
  count?: number;
  variant?: 'row' | 'card';
}

export function SkeletonList({ count = 5, variant = 'row' }: SkeletonListProps) {
  if (variant === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-bg-surface overflow-hidden">
      {Array.from({ length: count }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}
