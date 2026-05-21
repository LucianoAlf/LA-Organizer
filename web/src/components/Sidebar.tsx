import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays, Rocket, ClipboardCheck, Sparkles,
  Users, BarChart3, Target, Megaphone, Eye, UserCog,
  GraduationCap, Music,
  Package, ShoppingBag,
  CalendarRange, History, Settings,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAccess } from '../hooks/useAccess';
import { supabase } from '../lib/supabase';

interface SidebarProps {
  collapsed?: boolean;
  /** Callback para alternar collapsed manualmente. Se omitido, botão é escondido
   *  (ex.: tablet onde o estado é forçado pelo breakpoint). */
  onToggleCollapse?: () => void;
}

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  /** Rotas adicionais que ativam o item (ex.: Agenda ativa em /hoje e /semana). */
  matchPaths?: string[];
}

interface SectionDef {
  key: string;
  label: string;
  items: NavItem[];
}

export function Sidebar({ collapsed = false, onToggleCollapse }: SidebarProps) {
  const { collaborator, role } = useAuth();
  const location = useLocation();

  // É mentor? (idêntico ao Mais.tsx) — gate para "LA Educa" quando não é coord/director.
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

  const { allowed: showInventario } = useAccess('inventario');
  const { allowed: showLoja } = useAccess('loja_produtos');

  // Construção condicional das seções (mesmas regras do Mais.tsx).
  const sections: SectionDef[] = [
    {
      key: 'principal',
      label: 'Principal',
      items: [
        { to: '/hoje', label: 'Agenda', Icon: CalendarDays, matchPaths: ['/hoje', '/semana'] },
        { to: '/projetos', label: 'Projetos', Icon: Rocket },
        { to: '/checklists', label: 'Checklists', Icon: ClipboardCheck },
        { to: '/habitos', label: 'Hábitos', Icon: Sparkles },
      ],
    },
    {
      key: 'gestao',
      label: 'Gestão',
      items: [
        ...(role === 'coordinator' || role === 'director'
          ? [{ to: '/time', label: 'Dashboard time', Icon: Users } as NavItem]
          : []),
        ...(role === 'director' || role === 'manager'
          ? [{ to: '/mais/aderencia-checklists', label: 'Aderência', Icon: BarChart3 } as NavItem]
          : []),
        ...(role && ['director', 'coordinator', 'manager'].includes(role)
          ? [{ to: '/mais/operacoes', label: 'Operações', Icon: Target } as NavItem]
          : []),
        ...(role === 'director' || role === 'coordinator'
          ? [{ to: '/mais/comunicados', label: 'Comunicados', Icon: Megaphone } as NavItem]
          : []),
        ...(role === 'director' || role === 'coordinator'
          ? [{ to: '/mais/observabilidade', label: 'Observabilidade', Icon: Eye } as NavItem]
          : []),
        ...(role && ['director', 'coordinator', 'manager'].includes(role)
          ? [{ to: '/mais/gestao-equipe', label: 'Gestão equipe', Icon: UserCog } as NavItem]
          : []),
      ],
    },
    {
      key: 'educacao',
      label: 'Educação',
      items: [
        ...(role && (['coordinator', 'director'].includes(role) || isMentor)
          ? [{ to: '/la-educa', label: 'LA Educa', Icon: GraduationCap } as NavItem]
          : []),
        ...(role !== 'manager'
          ? [{ to: '/la-journey', label: 'LA Journey', Icon: Music } as NavItem]
          : []),
      ],
    },
    {
      key: 'operacoes',
      label: 'Operações',
      items: [
        ...(showInventario
          ? [{ to: '/inventario', label: 'Inventário', Icon: Package } as NavItem]
          : []),
        ...(showLoja
          ? [{ to: '/inventario/loja', label: 'Lojinha', Icon: ShoppingBag } as NavItem]
          : []),
      ],
    },
    {
      key: 'sistema',
      label: 'Sistema',
      items: [
        { to: '/mais/agenda-escolar', label: 'Agenda LA Music', Icon: CalendarRange },
        { to: '/historico', label: 'Histórico', Icon: History },
        { to: '/configuracoes', label: 'Configurações', Icon: Settings },
      ],
    },
  ];

  // Item ativo: NavLink usa default end=false; queremos match em prefix mas com matchPaths
  // tomar precedência (caso Agenda).
  function isActive(item: NavItem, defaultActive: boolean): boolean {
    if (item.matchPaths) return item.matchPaths.some(p => location.pathname.startsWith(p));
    return defaultActive;
  }

  const width = collapsed ? 64 : 240;

  return (
    <aside
      className="fixed top-0 left-0 bottom-0 z-40 bg-bg-surface border-r border-border flex flex-col"
      style={{ width }}
      aria-label="Navegação lateral"
    >
      {/* Header com avatar do TOM */}
      <div
        className={[
          'h-14 flex items-center border-b border-border shrink-0',
          collapsed ? 'justify-center px-2' : 'gap-3 px-4',
        ].join(' ')}
      >
        <img
          src="/Avata-Tom.png"
          alt="TOM"
          className="w-9 h-9 rounded-full object-cover shrink-0"
        />
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-fg leading-tight">TOM</div>
            <div className="text-[10px] text-fg-muted leading-tight">LA Organizer</div>
          </div>
        )}
      </div>

      {/* Lista de seções */}
      <nav className="flex-1 overflow-y-auto py-3">
        {sections.map(section => {
          if (section.items.length === 0) return null;
          return (
            <div key={section.key} className="mb-4">
              {!collapsed && (
                <div className="px-4 mb-1 text-[10px] uppercase tracking-wider text-fg-muted/60 font-semibold">
                  {section.label}
                </div>
              )}
              <ul className="space-y-0.5 px-2">
                {section.items.map(item => {
                  const { to, label, Icon } = item;
                  return (
                    <li key={to}>
                      <NavLink
                        to={to}
                        title={collapsed ? label : undefined}
                        className={({ isActive: navActive }) => {
                          const active = isActive(item, navActive);
                          const base = collapsed
                            ? 'flex items-center justify-center h-10 rounded-md transition-colors focus-ring'
                            : 'flex items-center gap-3 h-10 px-3 rounded-md transition-colors focus-ring';
                          const state = active
                            ? 'bg-tom/10 border-l-2 border-tom text-fg'
                            : 'text-fg-muted hover:bg-bg-elevated hover:text-fg';
                          return [base, state].join(' ');
                        }}
                      >
                        <Icon size={18} />
                        {!collapsed && (
                          <span className="text-body-sm font-medium truncate">{label}</span>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Rodapé — botão de recolher/expandir (só renderiza se houver callback;
          no tablet o estado é forçado pelo breakpoint, então não mostra). */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          aria-label={collapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          className={[
            'flex items-center border-t border-border shrink-0',
            'text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors',
            'focus-ring',
            collapsed ? 'justify-center h-12' : 'gap-2 px-4 h-12',
          ].join(' ')}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!collapsed && <span className="text-body-sm">Recolher</span>}
        </button>
      )}
    </aside>
  );
}
