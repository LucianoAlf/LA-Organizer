import { HTMLAttributes, ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  variant?: 'plain' | 'elevated' | 'brand' | 'outline';
  padded?: boolean;
  children?: ReactNode;
}

const variants: Record<NonNullable<Props['variant']>, string> = {
  plain: 'bg-bg-surface',
  elevated: 'bg-bg-elevated shadow-soft',
  outline: 'bg-bg-surface border border-border',
  // BRAND container — usar pontualmente (CTA / hero / highlight). NÃO padrão.
  brand: 'bg-brand text-white shadow-offset-brand',
};

export function Card({ variant = 'outline', padded = true, className = '', children, ...rest }: Props) {
  return (
    <div
      {...rest}
      className={[
        'rounded-md',
        variants[variant],
        padded ? 'p-md' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={['text-card-title', className].join(' ')}>{children}</h3>;
}

export function CardSubtle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={['text-body-sm text-fg-muted', className].join(' ')}>{children}</p>;
}
