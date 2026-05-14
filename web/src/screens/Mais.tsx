import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Badge } from '../components/Badge';

interface Item {
  to: string;
  label: string;
  hint: string;
  status?: 'soon' | 'beta';
  requireRoles?: string[];
}

const personalItems: Item[] = [
  { to: '/mais/agenda-escolar', label: 'Agenda LA Music', hint: 'Calendário institucional de eventos' },
  { to: '/configuracoes', label: 'Configurações', hint: 'Horários e intensidade do TOM' },
  { to: '/historico', label: 'Histórico', hint: 'Aderência dos últimos 30 dias' },
];

const coordItems: Item[] = [
  { to: '/time', label: 'Dashboard do time', hint: 'Coordenação · trabalho', requireRoles: ['coordinator', 'director'] },
  { to: '/mais/aderencia-checklists', label: 'Aderência operacional', hint: 'Checklists por colaborador', requireRoles: ['director', 'manager'] },
  { to: '/mais/operacoes', label: 'Operações', hint: 'Demandas operacionais por departamento', requireRoles: ['director', 'coordinator', 'manager'] },
  { to: '/mais/comunicados', label: 'Comunicados', hint: 'Anúncios para a equipe', requireRoles: ['director', 'coordinator'] },
  { to: '/mais/observabilidade', label: 'Observabilidade', hint: 'Aprovações e métricas de envio', requireRoles: ['director', 'coordinator'] },
  // Sprint 23.6
  { to: '/mais/gestao-equipe', label: 'Gestão de equipe', hint: 'Cadastrar e gerenciar colaboradores', requireRoles: ['director', 'coordinator', 'manager'] },
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
  const { collaborator, role } = useAuth();

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
    </div>
  );
}
