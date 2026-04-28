import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';

// Sprint 8: rotas de fluxo focado (wizard, etc) escondem o BottomNav e cedem
// o rodapé pro componente da rota controlar (ex: NovoProjeto tem própria nav).
// Quando crescer (>3 entradas), virar config de rota.
const FOCUSED_FLOW_PATHS = ['/projetos/novo'];

function isFocusedFlow(pathname: string): boolean {
  return FOCUSED_FLOW_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function AppShell() {
  const { pathname } = useLocation();
  const focused = isFocusedFlow(pathname);

  return (
    <div className="min-h-screen bg-bg-app text-fg flex flex-col">
      <Header />
      <main
        className={[
          'flex-1 w-full max-w-content mx-auto px-md pt-md',
          focused ? 'pb-md' : 'pb-[88px] md:pb-md',
        ].join(' ')}
      >
        <Outlet />
      </main>
      {!focused && <BottomNav />}
    </div>
  );
}
