import { NavLink } from 'react-router-dom';

// Sprint 22.11 — Agenda agrupa Hoje + Semana num único tab do bottom-nav.
// Hoje é first (default), Semana é o secundário. Mês fica para Sprint 23.
export function AgendaTabs() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    [
      'flex-1 text-center py-2 text-body-sm font-semibold rounded-md transition-colors focus-ring',
      isActive ? 'bg-tom text-white' : 'text-fg-muted hover:text-fg',
    ].join(' ');

  return (
    <div className="flex items-center gap-1 p-1 rounded-md bg-bg-elevated border border-border">
      <NavLink to="/hoje" className={cls}>Dia</NavLink>
      <NavLink to="/semana" className={cls}>Semana</NavLink>
    </div>
  );
}
