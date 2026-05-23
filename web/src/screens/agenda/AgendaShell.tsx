import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

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
}

export function AgendaShell(p: AgendaShellProps) {
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
        <div className="flex-1 flex items-center justify-center gap-2">
          <button onClick={p.onPrev} className="text-fg-muted hover:text-fg focus-ring rounded p-1.5"><ChevronLeft size={16}/></button>
          <button onClick={p.onToday}
            className="h-8 px-3 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring">
            Hoje
          </button>
          <div className="text-[13px] text-fg tabular-nums capitalize">{p.centerLabel}</div>
          <button onClick={p.onNext} className="text-fg-muted hover:text-fg focus-ring rounded p-1.5"><ChevronRight size={16}/></button>
        </div>
        <button onClick={p.onNewClick}
          className="h-8 px-3 rounded-md bg-tom text-black text-[12px] font-semibold hover:opacity-90 focus-ring inline-flex items-center gap-1">
          <Plus size={14}/> Novo
        </button>
      </header>
      <div className="flex-1 flex min-h-0">
        {p.leftRail}
        <main className="flex-1 min-w-0 flex flex-col">{p.children}</main>
        {p.rightRail}
      </div>
    </div>
  );
}
