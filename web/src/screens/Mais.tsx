import { ChevronRight, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useAccess } from '../hooks/useAccess';
import { Badge } from '../components/Badge';
import { supabase } from '../lib/supabase';

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

  const { data: isMentor = false } = useQuery({
    queryKey: ['is-mentor', collaborator?.id],
    queryFn: async () => {
      if (!collaborator) return false;
      const { count } = await supabase
        .from('la_educa_estagiarios')
        .select('id', { count: 'exact', head: true })
        .eq('mentor_id', collaborator.id);
      return (count ?? 0) > 0;
    },
    enabled: !!collaborator,
  });
  const showLaEduca = role === 'coordinator' || role === 'director' || isMentor;
  const showLaJourney = role !== 'manager';
  const showInventario = role === 'coordinator' || role === 'director' || role === 'manager';
  const showLoja = useAccess('loja_produtos').allowed;

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

      {(showLaEduca || showLaJourney || showInventario || showLoja) && (
        <section className="space-y-sm">
          <h3 className="text-body-sm text-fg-muted uppercase tracking-wide px-md">Educação</h3>
          <ul className="surface divide-y divide-border">
            {showLaEduca && (
              <li>
                <Link
                  to="/la-educa"
                  className="flex items-center justify-between gap-md p-md hover:bg-bg-elevated focus-ring"
                >
                  <div className="flex items-center gap-md">
                    <GraduationCap size={18} className="text-fg-muted" />
                    <div>
                      <div className="text-body-md">LA EDUCA</div>
                      <div className="text-body-sm text-fg-muted">Acompanhamento de estagiários</div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-fg-muted" />
                </Link>
              </li>
            )}
            {showLaJourney && (
              <li>
                <Link
                  to="/la-journey"
                  className="flex items-center justify-between gap-md p-md hover:bg-bg-elevated focus-ring"
                >
                  <div className="flex items-center gap-md">
                    <span className="text-body-md">🎵</span>
                    <div>
                      <div className="text-body-md">LA Journey</div>
                      <div className="text-body-sm text-fg-muted">Jornada pedagógica do aluno</div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-fg-muted" />
                </Link>
              </li>
            )}
            {showInventario && (
              <li>
                <Link
                  to="/inventario"
                  className="flex items-center justify-between gap-md p-md hover:bg-bg-elevated focus-ring"
                >
                  <div className="flex items-center gap-md">
                    <span className="text-body-md">📦</span>
                    <div>
                      <div className="text-body-md">Inventário</div>
                      <div className="text-body-sm text-fg-muted">Salas e equipamentos</div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-fg-muted" />
                </Link>
              </li>
            )}
            {showLoja && (
              <li>
                <Link
                  to="/inventario/loja"
                  className="flex items-center justify-between gap-md p-md hover:bg-bg-elevated focus-ring"
                >
                  <div className="flex items-center gap-md">
                    <span className="text-body-md">🛍</span>
                    <div>
                      <div className="text-body-md">Lojinha</div>
                      <div className="text-body-sm text-fg-muted">Vendas, estoque e reservas</div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-fg-muted" />
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
