import { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'brand' | 'tom' | 'success' | 'warning' | 'danger';
  className?: string;
}

// neutral = "nothing to highlight" — keep it visually quiet so danger/brand stand out.
const tones: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'text-fg-muted',
  brand: 'text-brand',
  tom: 'text-tom',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function StatCard({ label, value, hint, tone = 'neutral', className = '' }: Props) {
  return (
    <div
      className={[
        'rounded-md border border-border bg-bg-surface px-3 py-3 md:px-md md:py-md',
        'shadow-card dark:shadow-none',
        className,
      ].join(' ')}
    >
      <div className="text-[11px] md:text-label text-fg-muted uppercase tracking-wide leading-tight">{label}</div>
      <div
        className={[
          'mt-1 tabular-nums leading-none font-black',
          'text-[28px] md:text-h2-brand',
          tones[tone],
        ].join(' ')}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 text-body-sm text-fg-muted">{hint}</div>}
    </div>
  );
}
