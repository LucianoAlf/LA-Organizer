import { ReactNode } from 'react';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'project';

interface Props {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

const tones: Record<Tone, string> = {
  neutral: 'bg-bg-elevated text-fg-secondary border border-border',
  brand: 'bg-brand/15 text-brand border border-brand/30',
  success: 'bg-success/15 text-success border border-success/30',
  warning: 'bg-warning/15 text-warning border border-warning/30',
  danger: 'bg-danger/15 text-danger border border-danger/30',
  info: 'bg-info/15 text-info border border-info/30',
  project: 'bg-project/15 text-project border border-project/30',
};

export function Badge({ tone = 'neutral', children, className = '' }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-normal whitespace-nowrap',
        tones[tone],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
