import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { AgendaTabs } from './AgendaTabs';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ToastHost } from './Toast';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

const AGENDA_PATHS = ['/hoje', '/semana'];
function isAgendaRoute(pathname: string): boolean {
  return AGENDA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

/**
 * Shell desktop/tablet — Fase D1.
 *
 * Layout:
 *  - Sidebar fixa à esquerda (240px expandida / 64px colapsada em tablet)
 *  - Topbar fixo no topo (56px)
 *  - Conteúdo principal com max-w-content (720px) — Fase D1 mantém a largura
 *    de leitura mobile-style. Liberar para layouts multi-coluna é Fase D2.
 *
 * O AppShell mobile permanece intacto; este shell é paralelo.
 */
export function DesktopShell() {
  const bp = useBreakpoint();
  const { pathname } = useLocation();
  const collapsed = bp === 'tablet';
  const sidebarWidth = collapsed ? 64 : 240;
  const showAgendaTabs = isAgendaRoute(pathname);

  // Realtime sync com Supabase — mantém TanStack atualizado quando o TOM
  // escreve no banco via WhatsApp.
  const { collaborator } = useAuth();
  useRealtimeSync(collaborator?.id);

  return (
    <div className="min-h-screen bg-bg-app text-fg">
      <Sidebar collapsed={collapsed} />
      <Topbar sidebarCollapsed={collapsed} />
      <main
        className="pt-14 min-h-screen"
        style={{ marginLeft: sidebarWidth }}
      >
        {/* Tabs Dia/Semana — paridade com mobile. Renderizado no shell para que
            a MESMA instância persista entre /hoje ↔ /semana (indicador deslizante
            só anima se o elemento não for desmontado). */}
        {showAgendaTabs && (
          <div className="w-full max-w-7xl mx-auto px-6 lg:px-10 pt-6">
            <AgendaTabs />
          </div>
        )}
        {/* Fase D2.1 — libera largura desktop até max-w-7xl (1280px); tablet em
            max-w-5xl; mobile mantém max-w-content (720px). Padding lateral cresce
            no desktop para o conteúdo não colar nas bordas da tela em telas largas. */}
        <div className="w-full max-w-content md:max-w-5xl lg:max-w-7xl mx-auto px-4 md:px-6 lg:px-10 py-6">
          <Outlet />
        </div>
      </main>
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      <ToastHost />
    </div>
  );
}
