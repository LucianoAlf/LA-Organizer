import { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  className?: string;
}

const tones: Record<NonNullable<Props['tone']>, string> = {
  neutral: 'text-fg',
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function StatCard({ label, value, hint, tone = 'neutral', className = '' }: Props) {
  return (
    <div className={['rounded-md border border-border bg-bg-surface p-md', className].join(' ')}>
      <div className="text-label text-fg-muted uppercase tracking-wide">{label}</div>
      <div className={['mt-1 text-h2-brand tabular-nums leading-none', tones[tone]].join(' ')}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-body-sm text-fg-muted">{hint}</div>}
    </div>
  );
}
