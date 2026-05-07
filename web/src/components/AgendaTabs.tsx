import { NavLink, useLocation } from 'react-router-dom';

// Sprint 22.13 — iOS-style segmented control. Barra única com indicador
// olive que desliza entre Dia (default) e Semana. Renderizado no AppShell
// para a instância persistir entre rotas (essencial para a animação).
//
// Easing cubic-bezier(0.32, 0.72, 0, 1) é a curva da Apple HIG (UISpring),
// dá sensação de drag com leve overshoot. 400ms é o sweet spot — mais lento
// vira preguiça, mais rápido vira corte.
export function AgendaTabs() {
  const location = useLocation();
  const isSemana = location.pathname.startsWith('/semana');
  const activeIdx = isSemana ? 1 : 0;

  const labelCls = (active: boolean) =>
    [
      'relative z-10 flex-1 text-center py-2 text-body-sm font-semibold rounded-md focus-ring',
      'transition-colors duration-200',
      active ? 'text-white' : 'text-fg-muted hover:text-fg',
    ].join(' ');

  return (
    <div className="relative grid grid-cols-2 p-1 rounded-md bg-bg-elevated border border-border">
      {/* Indicador deslizante */}
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-md bg-tom shadow-sm"
        style={{
          left: '0.25rem',
          width: 'calc(50% - 0.25rem)',
          transform: `translateX(${activeIdx * 100}%)`,
          transition: 'transform 400ms cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
        }}
      />
      <NavLink to="/hoje" end className={() => labelCls(!isSemana)}>Dia</NavLink>
      <NavLink to="/semana" className={() => labelCls(isSemana)}>Semana</NavLink>
    </div>
  );
}
