// Sprint 22.30 — Eisenhower picker reutilizavel (Tarefa, Compromisso, edits).
// Visual: 4 chips coloridos. Toggle (clicar de novo desmarca, vira null).
// Decisao UX: NAO falar "Eisenhower" pro user. So "Prioridade" + opcoes.

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
}

interface ChipProps {
  active: boolean;
  tone: 'danger' | 'warning' | 'info' | 'neutral';
  onClick: () => void;
  label: string;
}

function Chip({ active, tone, onClick, label }: ChipProps) {
  const dot = {
    danger: 'bg-danger',
    warning: 'bg-warning',
    info: 'bg-info',
    neutral: 'bg-fg-muted/30',
  }[tone];
  const activeRing = {
    danger: 'border-danger bg-danger/10',
    warning: 'border-warning bg-warning/10',
    info: 'border-info bg-info/10',
    neutral: 'border-fg-muted/40 bg-bg-elevated',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-2 px-3 h-9 rounded-md border text-body-sm transition-colors focus-ring',
        active ? activeRing : 'border-border bg-bg-subtle text-fg-muted hover:text-fg',
      ].join(' ')}
    >
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span className={active ? 'text-fg font-semibold' : ''}>{label}</span>
    </button>
  );
}

export function EisenhowerPicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip active={value === 1} tone="danger" label="Urgente + importante"
        onClick={() => onChange(value === 1 ? null : 1)} />
      <Chip active={value === 2} tone="warning" label="Importante"
        onClick={() => onChange(value === 2 ? null : 2)} />
      <Chip active={value === 3} tone="info" label="Urgente"
        onClick={() => onChange(value === 3 ? null : 3)} />
      <Chip active={value === 4} tone="neutral" label="Nem um nem outro"
        onClick={() => onChange(value === 4 ? null : 4)} />
    </div>
  );
}
