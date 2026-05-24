import { Link } from 'react-router-dom';
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import type { AgendaContext } from './hooks/useAgendaFilters';

export type AgendaView = 'day' | 'week' | 'month';

export interface AgendaShellProps {
  view: AgendaView;
  currentDate: Date;
  centerLabel: string;
  leftRail: React.ReactNode;
  rightRail: React.ReactNode;
  children: React.ReactNode;
  onChangeView: (view: AgendaView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewClick: () => void;
  currentContext: AgendaContext;
  contextCounts: { work: number; personal: number; delegated: number };
  onChangeContext: (ctx: AgendaContext) => void;
}

export function AgendaShell(p: AgendaShellProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const { collaborator } = useAuth();
  const avatarUrl = collaborator?.avatar_url;
  const displayName = collaborator?.preferred_name || collaborator?.full_name || 'Perfil';

  return (
    <div className="flex flex-col h-full bg-bg-app">
      <header className="h-14 shrink-0 border-b border-border bg-bg-surface flex items-center px-4 gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-fg-muted" />
          <span className="text-[14px] font-semibold text-fg">Agenda</span>
          <div className="ml-4 inline-flex rounded-md border border-border bg-bg-elevated overflow-hidden">
            {(['day','week','month'] as const).map(v => (
              <button key={v} onClick={() => p.onChangeView(v)}
                className={['h-8 px-3 text-[12px] focus-ring',
                  p.view === v ? 'bg-tom text-black font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}>
                {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
        </div>

        <button onClick={p.onToday}
          className="h-8 px-4 rounded-full bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring font-medium">
          Hoje
        </button>

        <div className="flex items-center gap-1 px-2">
          <button onClick={p.onPrev} aria-label="Anterior" className="text-fg-muted hover:text-fg focus-ring rounded p-1.5"><ChevronLeft size={16}/></button>
          <div className="text-[13px] text-fg capitalize px-2 min-w-[200px] text-center select-none">{p.centerLabel}</div>
          <button onClick={p.onNext} aria-label="Próximo" className="text-fg-muted hover:text-fg focus-ring rounded p-1.5"><ChevronRight size={16}/></button>
        </div>

        <div className="ml-auto inline-flex gap-1.5 mr-3">
          {([
            { id: 'work',      label: 'Trabalho',  count: p.contextCounts.work },
            { id: 'personal',  label: 'Pessoal',   count: p.contextCounts.personal },
            { id: 'delegated', label: 'Delegadas', count: p.contextCounts.delegated },
          ] as const).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => p.onChangeContext(t.id)}
              className={[
                'h-8 px-3 rounded-full text-[12px] focus-ring border',
                p.currentContext === t.id
                  ? 'bg-tom/15 text-tom border-tom/40 font-medium'
                  : 'bg-bg-elevated text-fg-muted border-border hover:text-fg',
              ].join(' ')}
            >
              {t.label} · {t.count}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* "+ Novo" foi promovido a FAB no canto inferior direito (paridade com mobile) */}

          {/* Notificações — placeholder (sem ação por ora, idem TopbarV2) */}
          <button type="button" aria-label="Notificações"
            className="h-8 w-8 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated border border-border focus-ring">
            <Bell size={15} />
          </button>

          {/* Toggle tema (dark/light) */}
          <button type="button" aria-label={`Alternar para tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
            onClick={toggleTheme}
            className="h-8 w-8 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated border border-border focus-ring">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Avatar — link pro perfil (sem menu por ora; quem quer logout/config usa sidebar global) */}
          <Link to="/meu-perfil" aria-label={displayName}
            className="h-8 w-8 rounded-full overflow-hidden border border-border bg-bg-elevated grid place-items-center text-fg-muted hover:text-fg focus-ring">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-[11px] font-semibold">{displayName.slice(0, 1).toUpperCase()}</span>
            )}
          </Link>
        </div>
      </header>
      <div className="flex-1 flex min-h-0">
        {p.leftRail}
        <main className="flex-1 min-w-0 flex flex-col">{p.children}</main>
        {p.rightRail}
      </div>
    </div>
  );
}
