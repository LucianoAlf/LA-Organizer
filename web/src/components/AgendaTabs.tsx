import { NavLink } from 'react-router-dom';

// Sprint 22.11 — Agenda tab bar: botões separados com gap (aberturinhas).
// Dia é first/default; Semana é o secundário. Mês fica para Sprint 23.
export function AgendaTabs() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    [
      'flex-1 text-center py-2 px-4 text-body-sm font-semibold rounded-md border transition-colors focus-ring',
      isActive
        ? 'bg-tom border-tom text-white'
        : 'bg-bg-surface border-border text-fg-muted hover:text-fg hover:border-fg-muted',
    ].join(' ');

  return (
    <div className="flex items-center gap-2">
      <NavLink to="/hoje" end className={cls}>Dia</NavLink>
      <NavLink to="/semana" className={cls}>Semana</NavLink>
    </div>
  );
}
