import type { ReactNode } from 'react';

interface PageShellProps {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  preHeader?: ReactNode;
}

export function PageShell({ title, subtitle, toolbar, children, preHeader }: PageShellProps) {
  return (
    <div className="flex flex-col gap-6 min-h-full">
      {preHeader}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-fg leading-tight truncate">{title}</h1>
          {subtitle && (
            <p className="text-[13px] text-fg-muted mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        {toolbar && <div className="shrink-0">{toolbar}</div>}
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
