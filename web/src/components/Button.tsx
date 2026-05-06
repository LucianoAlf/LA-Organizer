import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-tom text-white hover:bg-tom-shade active:bg-tom-deep disabled:bg-tom/50',
  secondary: 'bg-bg-surface text-fg border border-border hover:bg-bg-elevated',
  ghost: 'bg-transparent text-fg hover:bg-bg-surface',
  danger: 'bg-danger text-white hover:bg-danger/90',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-body-sm',
  md: 'h-11 px-4 text-body-md font-semibold',
  lg: 'h-12 px-5 text-body-lg font-semibold',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', fullWidth, leadingIcon, trailingIcon, loading, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      disabled={rest.disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-md transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-70',
        'focus-ring',
        variants[variant],
        sizes[size],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
    >
      {loading ? <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden /> : leadingIcon}
      <span className="truncate">{children}</span>
      {!loading && trailingIcon}
    </button>
  );
});
