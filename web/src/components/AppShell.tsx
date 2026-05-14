import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { AgendaTabs } from './AgendaTabs';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { ToastHost } from './Toast';

const FOCUSED_FLOW_PATHS = ['/projetos/novo'];
const AGENDA_PATHS = ['/hoje', '/semana'];

function isFocusedFlow(pathname: string): boolean {
  return FOCUSED_FLOW_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isAgendaRoute(pathname: string): boolean {
  return AGENDA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function AppShell() {
  const { pathname } = useLocation();
  const focused = isFocusedFlow(pathname);
  const showAgendaTabs = isAgendaRoute(pathname);

  return (
    <div className="min-h-screen bg-bg-app text-fg flex flex-col">
      <Header />
      {/* AgendaTabs renderizado no shell para a MESMA instância persistir entre
          /hoje ↔ /semana — sem isso o indicador deslizante não anima (re-render
          em cada rota destrói o elemento antes da transição rodar). */}
      {showAgendaTabs && (
        <div className="w-full max-w-content mx-auto px-md pt-md">
          <AgendaTabs />
        </div>
      )}
      <main
        className={[
          'flex-1 w-full max-w-content mx-auto px-md',
          showAgendaTabs ? 'pt-md' : 'pt-md',
          focused ? 'pb-md' : 'pb-[88px] md:pb-md',
        ].join(' ')}
      >
        <Outlet />
      </main>
      {!focused && <BottomNav />}
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      <ToastHost />
    </div>
  );
}
