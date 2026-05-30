import { NavLink } from 'react-router-dom';

export type FinanceTab = 'dashboard' | 'transacoes' | 'contas' | 'metas' | 'carteiras';

const TABS: { id: FinanceTab; to: string; label: string }[] = [
  { id: 'dashboard',  to: '/financeiro',            label: 'Visão' },
  { id: 'transacoes', to: '/financeiro/transacoes', label: 'Transações' },
  { id: 'contas',     to: '/financeiro/contas',     label: 'Contas' },
  { id: 'metas',      to: '/financeiro/metas',      label: 'Metas' },
  { id: 'carteiras',  to: '/financeiro/carteiras',  label: 'Carteiras' },
];

export function FinanceTabs({ current: _current }: { current: FinanceTab }) {
  // current está aqui só pra documentar intenção; o NavLink já cuida do active state via end/exact.
  return (
    <nav aria-label="Seções de finanças" className="-mx-md md:mx-0 overflow-x-auto scrollbar-none">
      <ul className="flex gap-1.5 px-md md:px-0 min-w-max">
        {TABS.map((t) => (
          <li key={t.id}>
            <NavLink
              to={t.to}
              end={t.to === '/financeiro'}
              className={({ isActive }) => [
                'inline-flex items-center h-8 rounded-full px-3 text-body-sm transition-colors focus-ring',
                isActive
                  ? 'bg-tom/10 text-tom border border-tom/40 font-semibold'
                  : 'bg-bg-surface text-fg-muted border border-border hover:text-fg hover:border-fg-muted/40',
              ].join(' ')}
            >
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
