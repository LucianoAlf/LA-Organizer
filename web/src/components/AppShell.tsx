import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';

const FOCUSED_FLOW_PATHS = ['/projetos/novo'];

function isFocusedFlow(pathname: string): boolean {
  return FOCUSED_FLOW_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

// Agenda routes em ordem: /hoje (0) → /semana (1). Slide right = avançar, left = voltar.
const AGENDA_PATHS = ['/hoje', '/semana'];

function useAgendaSlideClass(pathname: string): string {
  const prevRef = useRef<string>(pathname);
  const classRef = useRef<string>('');

  const prev = prevRef.current;
  const curIdx = AGENDA_PATHS.indexOf(pathname);
  const prevIdx = AGENDA_PATHS.indexOf(prev);

  if (pathname !== prev) {
    if (curIdx !== -1 && prevIdx !== -1) {
      classRef.current = curIdx > prevIdx ? 'agenda-slide-right' : 'agenda-slide-left';
    } else {
      classRef.current = '';
    }
    prevRef.current = pathname;
  }

  return classRef.current;
}

export function AppShell() {
  const { pathname } = useLocation();
  const focused = isFocusedFlow(pathname);
  const slideClass = useAgendaSlideClass(pathname);

  return (
    <div className="min-h-screen bg-bg-app text-fg flex flex-col">
      <Header />
      <main
        className={[
          'flex-1 w-full max-w-content mx-auto px-md pt-md',
          focused ? 'pb-md' : 'pb-[88px] md:pb-md',
        ].join(' ')}
      >
        <div key={pathname} className={slideClass || undefined} style={{ overflow: 'hidden' }}>
          <Outlet />
        </div>
      </main>
      {!focused && <BottomNav />}
      <PWAUpdatePrompt />
    </div>
  );
}
