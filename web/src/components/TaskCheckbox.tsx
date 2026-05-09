import { Check } from 'lucide-react';

// Sprint 22 Phase A — checkbox redondo padrão pra tarefa. Antes vivia inline em
// TaskRow (h-6 w-6) e Semana (h-4 w-4). Spec: docs/design-system.md §4.2.

type Size = 'sm' | 'md';

interface Props {
  done: boolean;
  /** Pinta a borda em danger quando pendente e atrasada. */
  overdue?: boolean;
  /** Bloqueia interação (status cancelled, mutation pending). */
  disabled?: boolean;
  size?: Size;
  onClick?: () => void;
  ariaLabel?: string;
}

const SIZE_CLS: Record<Size, { box: string; icon: number; mt: string }> = {
  sm: { box: 'h-4 w-4', icon: 10, mt: 'mt-1' },
  md: { box: 'h-6 w-6', icon: 14, mt: 'mt-0.5' },
};

export function TaskCheckbox({ done, overdue = false, disabled = false, size = 'md', onClick, ariaLabel }: Props) {
  const s = SIZE_CLS[size];
  const label = ariaLabel ?? (done ? 'Reabrir tarefa' : 'Concluir tarefa');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={done ? 'Reabrir' : 'Concluir'}
      className={[
        s.mt, s.box,
        'shrink-0 rounded-full border-2 grid place-items-center transition-colors focus-ring',
        done
          ? 'bg-tom border-tom text-black hover:bg-tom-shade'
          : overdue
            ? 'border-danger text-transparent hover:bg-tom/10 hover:text-tom'
            : 'border-fg-muted text-transparent hover:border-tom hover:bg-tom/10 hover:text-tom',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {done && <Check size={s.icon} strokeWidth={3} />}
    </button>
  );
}
