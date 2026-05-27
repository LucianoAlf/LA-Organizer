// Sprint 23 — RecurrenceField: chips Uma vez/Diária/Semanal/Mensal + sub-campos

export interface RecurrenceValue {
  recurrence_type: 'once' | 'daily' | 'weekly' | 'monthly';
  days_of_week?: number[] | null;
  day_of_month?: number | null;
}

interface Props {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
}

const TYPES: Array<{ v: RecurrenceValue['recurrence_type']; label: string }> = [
  { v: 'once', label: 'Uma vez' },
  { v: 'daily', label: 'Diária' },
  { v: 'weekly', label: 'Semanal' },
  { v: 'monthly', label: 'Mensal' },
];

const WEEK = [
  { v: 1, label: 'Dom' },
  { v: 2, label: 'Seg' },
  { v: 3, label: 'Ter' },
  { v: 4, label: 'Qua' },
  { v: 5, label: 'Qui' },
  { v: 6, label: 'Sex' },
  { v: 7, label: 'Sáb' },
];

export function RecurrenceField({ value, onChange }: Props) {
  const setType = (t: RecurrenceValue['recurrence_type']) => {
    onChange({
      recurrence_type: t,
      days_of_week: t === 'weekly' ? [] : null,
      day_of_month: t === 'monthly' ? 1 : null,
    });
  };

  const toggleDay = (d: number) => {
    const days = value.days_of_week ?? [];
    onChange({
      ...value,
      days_of_week: days.includes(d)
        ? days.filter((x) => x !== d)
        : [...days, d].sort(),
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {TYPES.map((t) => (
          <button
            key={t.v}
            onClick={() => setType(t.v)}
            type="button"
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${
              value.recurrence_type === t.v
                ? 'bg-tom text-bg-app'
                : 'bg-bg-app text-fg/60 border border-border hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {value.recurrence_type === 'weekly' && (
        <div className="flex flex-wrap gap-1 pt-1">
          {WEEK.map((d) => (
            <button
              key={d.v}
              onClick={() => toggleDay(d.v)}
              type="button"
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                (value.days_of_week ?? []).includes(d.v)
                  ? 'bg-tom text-bg-app'
                  : 'bg-bg-app text-fg/60 border border-border'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
      {value.recurrence_type === 'monthly' && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-fg/60">Todo dia</span>
          <input
            type="number"
            min={1}
            max={31}
            value={value.day_of_month ?? 1}
            onChange={(e) =>
              onChange({
                ...value,
                day_of_month: parseInt(e.target.value, 10) || 1,
              })
            }
            className="w-20 bg-bg-app border border-border rounded-md p-2 text-sm focus:outline-none focus:border-tom"
          />
          <span className="text-xs text-fg/60">do mês</span>
        </div>
      )}
    </div>
  );
}
