import { NavLink, useLocation } from 'react-router-dom';
import { CalendarDays, Rocket, ClipboardCheck, Sparkles, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof CalendarDays;
  /** Rotas adicionais que devem ativar este item (p.ex. Agenda ativa em /hoje e /semana). */
  matchPaths?: string[];
}

// Sprint 22.11 — Agenda agrupa Hoje + Semana num único tab.
// Hoje é o default ao tocar em Agenda. Hábitos sai do Mais e ganha tab próprio
// (uso diário, mereceu acesso de 1 toque).
const items: NavItem[] = [
  { to: '/hoje', label: 'Agenda', Icon: CalendarDays, matchPaths: ['/hoje', '/semana'] },
  { to: '/projetos', label: 'Projetos', Icon: Rocket },
  { to: '/checklists', label: 'Checklists', Icon: ClipboardCheck },
  { to: '/habitos', label: 'Hábitos', Icon: Sparkles },
  { to: '/mais', label: 'Mais', Icon: Menu },
];

export function BottomNav() {
  const { role } = useAuth();
  const location = useLocation();
  const showsTime = role === 'coordinator' || role === 'director';

  function isItemActive(item: NavItem, defaultActive: boolean): boolean {
    if (item.matchPaths) return item.matchPaths.some(p => location.pathname.startsWith(p));
    return defaultActive;
  }

  return (
    <nav
      role="navigation"
      aria-label="Navegação principal"
      className="fixed bottom-0 inset-x-0 z-30 bg-bg-surface/95 backdrop-blur border-t border-border md:static md:bg-bg-app md:backdrop-blur-0"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5 max-w-content mx-auto md:hidden">
        {items.map(item => {
          const { to, label, Icon } = item;
          return (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => {
                  const active = isItemActive(item, isActive);
                  return [
                    'flex flex-col items-center justify-center gap-1 py-2.5 focus-ring',
                    active ? 'text-tom' : 'text-fg-muted',
                  ].join(' ');
                }}
              >
                {({ isActive }) => {
                  const _active = isItemActive(item, isActive);
                  void _active;
                  return (
                    <>
                      <Icon size={22} />
                      <span className="text-[11px] font-semibold tracking-wide">{label}</span>
                    </>
                  );
                }}
              </NavLink>
            </li>
          );
        })}
      </ul>

      {/* Desktop top-rail (replaces bottom nav at md+) */}
      <ul className="hidden md:flex items-center gap-md max-w-content mx-auto px-md py-2">
        {items.map(item => {
          const { to, label, Icon } = item;
          return (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => {
                  const active = isItemActive(item, isActive);
                  return [
                    'inline-flex items-center gap-2 px-3 py-2 rounded-md focus-ring',
                    active ? 'bg-bg-surface text-tom' : 'text-fg-muted hover:text-fg',
                  ].join(' ');
                }}
              >
                <Icon size={18} />
                <span className="text-body-sm font-semibold">{label}</span>
              </NavLink>
            </li>
          );
        })}
        {showsTime && (
          <li>
            <NavLink
              to="/time"
              className={({ isActive }) =>
                [
                  'inline-flex items-center gap-2 px-3 py-2 rounded-md focus-ring',
                  isActive ? 'bg-bg-surface text-tom' : 'text-fg-muted hover:text-fg',
                ].join(' ')
              }
            >
              <span className="text-body-sm font-semibold">Time</span>
            </NavLink>
          </li>
        )}
      </ul>
    </nav>
  );
}
