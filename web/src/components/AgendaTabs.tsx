import { NavLink, useLocation } from 'react-router-dom';

// Sprint 22.13 — iOS-style segmented control. Barra única com indicador
// olive que desliza entre Dia (default) e Semana ao trocar de tab.
export function AgendaTabs() {
  const location = useLocation();
  const isSemana = location.pathname.startsWith('/semana');
  const activeIdx = isSemana ? 1 : 0;

  const labelCls = (active: boolean) =>
    [
      'relative z-10 flex-1 text-center py-2 text-body-sm font-semibold rounded-md transition-colors focus-ring',
      active ? 'text-white' : 'text-fg-muted hover:text-fg',
    ].join(' ');

  return (
    <div className="relative grid grid-cols-2 p-1 rounded-md bg-bg-elevated border border-border">
      {/* Indicador deslizante — translateX(0) em Dia, translateX(100%) em Semana */}
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-md bg-tom shadow-sm transition-transform duration-300 ease-out"
        style={{
          left: '0.25rem',
          width: 'calc(50% - 0.25rem)',
          transform: `translateX(${activeIdx * 100}%)`,
        }}
      />
      <NavLink to="/hoje" end className={() => labelCls(!isSemana)}>Dia</NavLink>
      <NavLink to="/semana" className={() => labelCls(isSemana)}>Semana</NavLink>
    </div>
  );
}
