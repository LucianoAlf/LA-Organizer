import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Badge } from '../components/Badge';

interface Item {
  to: string;
  label: string;
  hint: string;
  status?: 'soon' | 'beta';
  requireRoles?: string[];
}

const personalItems: Item[] = [
  { to: '/configuracoes', label: 'Configurações', hint: 'Horários e intensidade do TOM' },
  { to: '/historico', label: 'Histórico', hint: 'Aderência dos últimos 30 dias' },
];

const coordItems: Item[] = [
  { to: '/time', label: 'Dashboard do time', hint: 'Coordenação · trabalho', requireRoles: ['coordinator', 'director'] },
  { to: '/mais/aderencia-checklists', label: 'Aderência operacional', hint: 'Checklists por colaborador', requireRoles: ['director', 'manager'] },
  { to: '/mais/operacoes', label: 'Operações', hint: 'Demandas operacionais por departamento', requireRoles: ['director', 'coordinator', 'manager'] },
  { to: '/mais/comunicados', label: 'Comunicados', hint: 'Anúncios para a equipe', requireRoles: ['director', 'coordinator'] },
  { to: '/mais/agenda-escolar', label: 'Agenda Escolar', hint: 'Eventos e comunicações', requireRoles: ['director', 'coordinator'] },
  { to: '/mais/checklists-templates', label: 'Templates de checklists', hint: 'CRUD dos modelos operacionais', requireRoles: ['director', 'coordinator'] },
  { to: '/mais/observabilidade', label: 'Observabilidade', hint: 'Aprovações e métricas de envio', requireRoles: ['director', 'coordinator'] },
];

function ItemRow({ it }: { it: Item }) {
  if (it.status === 'soon') {
    return (
      <div className="flex items-center justify-between gap-md p-md opacity-60 cursor-not-allowed">
        <div>
          <div className="text-body-md">{it.label}</div>
          <div className="text-body-sm text-fg-muted">{it.hint}</div>
        </div>
        <Badge>em breve</Badge>
      </div>
    );
  }
  return (
    <Link to={it.to} className="flex items-center justify-between gap-md p-md hover:bg-bg-elevated focus-ring">
      <div>
        <div className="text-body-md">{it.label}</div>
        <div className="text-body-sm text-fg-muted">{it.hint}</div>
      </div>
      <ChevronRight size={18} className="text-fg-muted" />
    </Link>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-sm">
      <h3 className="text-body-sm text-fg-muted uppercase tracking-wide px-md">{title}</h3>
      <ul className="surface divide-y divide-border">
        {items.map(it => (
          <li key={it.label}><ItemRow it={it} /></li>
        ))}
      </ul>
    </section>
  );
}

export function Mais() {
  const { collaborator, role, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  const filterByRole = (list: Item[]) =>
    list.filter(i => !i.requireRoles || (role && i.requireRoles.includes(role)));

  const personal = filterByRole(personalItems);
  const coord = filterByRole(coordItems);

  const unit = collaborator?.unit;
  const unitLabel = unit && unit !== 'all' ? unit : null;
  const headerMeta = [collaborator?.full_name, role ?? 'sem role', unitLabel].filter(Boolean).join(' · ');

  return (
    <div className="space-y-lg">
      <header>
        <h2 className="text-section-title">Mais</h2>
        <p className="text-body-sm text-fg-muted mt-1">{headerMeta}</p>
      </header>

      <Section title="Para você" items={personal} />
      <Section title="Coordenação" items={coord} />

      <section className="surface p-md space-y-md">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-body-md">Tema</div>
            <div className="text-body-sm text-fg-muted">Dark é o padrão · light é suportado</div>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="h-9 px-3 rounded-sm bg-bg-elevated border border-border text-body-sm focus-ring"
          >
            {theme === 'dark' ? 'Mudar pra claro' : 'Mudar pra escuro'}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-body-md">Sair</div>
            <div className="text-body-sm text-fg-muted">Encerra sua sessão local</div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="h-9 px-3 rounded-sm bg-danger/10 border border-danger/40 text-danger text-body-sm focus-ring"
          >
            Sair
          </button>
        </div>
      </section>
    </div>
  );
}
