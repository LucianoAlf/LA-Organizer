import { Check } from 'lucide-react';

// Checkbox quadradinho do design system — alternativa nativa ao <input type="checkbox">.
// Quando marcado: bg-tom + check preto dentro (oliva, alinhado com TaskCheckbox).
// Pra checkbox redondo de tarefa, use <TaskCheckbox /> em vez deste.

type Size = 'sm' | 'md';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  hint?: string;
  size?: Size;
  disabled?: boolean;
}

const SIZE_CLS: Record<Size, { box: string; icon: number }> = {
  sm: { box: 'h-4 w-4', icon: 10 },
  md: { box: 'h-5 w-5', icon: 12 },
};

export function Checkbox({ checked, onChange, label, hint, size = 'md', disabled = false }: Props) {
  const s = SIZE_CLS[size];
  return (
    <label
      className={[
        'flex items-start gap-2 text-body select-none',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={[
          s.box,
          'shrink-0 mt-0.5 rounded-md border-2 grid place-items-center transition-colors',
          checked
            ? 'bg-tom border-tom text-black'
            : 'border-fg-muted bg-transparent text-transparent peer-hover:border-tom peer-hover:bg-tom/10',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-tom/40 peer-focus-visible:ring-offset-1',
        ].join(' ')}
      >
        {checked && <Check size={s.icon} strokeWidth={3} />}
      </span>
      {(label || hint) && (
        <span className="flex-1 min-w-0">
          {label && <span className="block">{label}</span>}
          {hint && <span className="block text-caption text-fg-muted mt-0.5">{hint}</span>}
        </span>
      )}
    </label>
  );
}
