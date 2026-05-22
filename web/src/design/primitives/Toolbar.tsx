import type { ReactNode } from 'react';

interface ToolbarProps {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Toolbar({ left, right, children, className = '' }: ToolbarProps) {
  if (children) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>{children}</div>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap min-w-0">{left}</div>
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </div>
  );
}
