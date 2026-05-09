// web/src/components/TimeWindowChips.tsx
// Sprint 22.37 — toggle Hoje/Semana/Mês.
import type { AdherenceWindow } from '../types'

interface Props {
  value: AdherenceWindow
  onChange: (next: AdherenceWindow) => void
}

const OPTIONS: { value: AdherenceWindow; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
]

export function TimeWindowChips({ value, onChange }: Props) {
  return (
    <div className="inline-flex gap-1 p-1 rounded-lg bg-bg-elevated">
      {OPTIONS.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              'px-3 py-1.5 rounded-md text-body-sm font-medium transition-colors focus-ring',
              active
                ? 'bg-tom text-black shadow-sm'
                : 'text-fg-muted hover:text-fg hover:bg-bg-app',
            ].join(' ')}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
