import { NavLink } from 'react-router-dom';
import { Circle, CalendarDays, Rocket, ClipboardCheck, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof Circle;
}

const items: NavItem[] = [
  { to: '/hoje', label: 'Hoje', Icon: Circle },
  { to: '/semana', label: 'Semana', Icon: CalendarDays },
  { to: '/projetos', label: 'Projetos', Icon: Rocket },
  { to: '/checklists', label: 'Checklists', Icon: ClipboardCheck },
  { to: '/mais', label: 'Mais', Icon: Menu },
];

export function BottomNav() {
  const { role } = useAuth();
  const showsTime = role === 'coordinator' || role === 'director';

  return (
    <nav
      role="navigation"
      aria-label="Navegação principal"
      className="fixed bottom-0 inset-x-0 z-30 bg-bg-surface/95 backdrop-blur border-t border-border md:static md:bg-bg-app md:backdrop-blur-0"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5 max-w-content mx-auto md:hidden">
        {items.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                [
                  'flex flex-col items-center justify-center gap-1 py-2.5 focus-ring',
                  isActive ? 'text-brand' : 'text-fg-muted',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} fill={isActive && to === '/hoje' ? 'currentColor' : 'none'} />
                  <span className="text-[11px] font-semibold tracking-wide">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Desktop top-rail (replaces bottom nav at md+) */}
      <ul className="hidden md:flex items-center gap-md max-w-content mx-auto px-md py-2">
        {items.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                [
                  'inline-flex items-center gap-2 px-3 py-2 rounded-md focus-ring',
                  isActive ? 'bg-bg-surface text-brand' : 'text-fg-muted hover:text-fg',
                ].join(' ')
              }
            >
              <Icon size={18} />
              <span className="text-body-sm font-semibold">{label}</span>
            </NavLink>
          </li>
        ))}
        {showsTime && (
          <li>
            <NavLink
              to="/time"
              className={({ isActive }) =>
                [
                  'inline-flex items-center gap-2 px-3 py-2 rounded-md focus-ring',
                  isActive ? 'bg-bg-surface text-brand' : 'text-fg-muted hover:text-fg',
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
