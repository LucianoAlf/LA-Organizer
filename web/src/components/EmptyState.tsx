import { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: Props) {
  return (
    <div className="text-center py-2xl px-md">
      {icon && <div className="mx-auto mb-md text-fg-muted">{icon}</div>}
      <h3 className="text-card-title">{title}</h3>
      {description && <p className="text-body-md text-fg-muted mt-2 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-md">{action}</div>}
    </div>
  );
}
