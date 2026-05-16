import type { ReactNode } from 'react';

interface Props {
  variant: 'danger' | 'warning' | 'success';
  title: string;
  count: number;
  children?: ReactNode;
}

const STYLES = {
  danger:  'bg-danger/10 text-danger border-danger/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  success: 'bg-success/10 text-success border-success/30',
};

const ICONS = { danger: '🔴', warning: '🟡', success: '🟢' };

export function AlertCard({ variant, title, count, children }: Props) {
  if (count === 0) return null;
  return (
    <div className={`rounded-lg p-md border ${STYLES[variant]} space-y-xs`}>
      <div className="flex items-center justify-between font-semibold">
        <span>{ICONS[variant]} {title}</span>
        <span className="text-body-sm">{count}</span>
      </div>
      {children && <div className="text-body-sm">{children}</div>}
    </div>
  );
}
