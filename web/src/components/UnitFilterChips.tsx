// web/src/components/UnitFilterChips.tsx
// Sprint 22.37 — chips de filtro por unidade. Visível só pra director.
// Manager unit-específica não vê (já filtra automaticamente via RLS).

interface Props {
  value: string | null // null = todas
  onChange: (next: string | null) => void
}

const UNITS: { value: string | null; label: string }[] = [
  { value: null, label: 'Todas' },
  { value: 'barra', label: 'Barra' },
  { value: 'recreio', label: 'Recreio' },
  { value: 'campo_grande', label: 'Campo Grande' },
]

export function UnitFilterChips({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {UNITS.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.value)}
            className={[
              'px-3 py-1.5 rounded-full text-body-sm font-medium transition-colors focus-ring',
              active
                ? 'bg-tom text-white'
                : 'bg-bg-elevated text-fg-muted hover:text-fg hover:bg-bg-app border border-border',
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
