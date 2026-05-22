import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateDesktopProps {
  Icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: 'sm' | 'md';
}

export function EmptyStateDesktop({
  Icon,
  title,
  description,
  action,
  size = 'md',
}: EmptyStateDesktopProps) {
  const iconSize = size === 'sm' ? 32 : 48;
  const titleClass = size === 'sm' ? 'text-[14px]' : 'text-[16px]';
  const padding = size === 'sm' ? 'py-8' : 'py-16';

  return (
    <div className={`flex flex-col items-center justify-center text-center ${padding} px-6`}>
      <div className="w-16 h-16 rounded-full bg-bg-elevated grid place-items-center mb-4">
        <Icon size={iconSize} className="text-fg-muted" strokeWidth={1.5} />
      </div>
      <h3 className={`${titleClass} font-semibold text-fg mb-1`}>{title}</h3>
      {description && (
        <p className="text-[13px] text-fg-muted max-w-sm mb-4">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
