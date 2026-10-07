// CONFIRMACAO-DE-EVENTO (edição, 07/10) — banner único pra "já passou" + conflito nos caminhos de
// edição (EditEventSheet, EventEditDrawer). Mesmo visual dos banners da criação.
import { conflictRange, type TimeWarnings } from '../lib/eventPreflight';

export function EventTimeWarningBanner({ warnings }: { warnings: TimeWarnings }) {
  const n = warnings.conflicts.length;
  return (
    <div className="rounded-md border border-warning bg-warning/10 p-3 space-y-2" role="alert">
      <div className="text-body-sm font-semibold text-warning">
        ⚠ {warnings.past && n > 0 ? 'Horário no passado e com conflito' : warnings.past ? 'Horário no passado' : 'Conflito de horário'}
      </div>
      {warnings.past && (
        <div className="text-body-sm text-fg">
          Esse horário já passou (<span className="tabular-nums">{warnings.past}</span>).
        </div>
      )}
      {n > 0 && (
        <>
          <div className="text-body-sm text-fg">
            Você já tem {n === 1 ? 'um compromisso' : `${n} compromissos`} nesse horário:
          </div>
          <ul className="text-body-sm text-fg-secondary space-y-0.5">
            {warnings.conflicts.map(c => (
              <li key={c.id}>• <span className="tabular-nums">{conflictRange(c)}</span> — {c.title}</li>
            ))}
          </ul>
        </>
      )}
      <div className="text-body-sm text-fg-muted pt-1">É isso mesmo? Se não, volta e ajusta o horário.</div>
    </div>
  );
}
