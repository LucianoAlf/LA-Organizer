import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { SidebarV2 } from '../design/shell/SidebarV2';
import { TopbarV2 } from '../design/shell/TopbarV2';
import { AgendaTabs } from './AgendaTabs';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ToastHost } from './Toast';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

const AGENDA_PATHS = ['/hoje', '/semana'];
const FULLSCREEN_PATHS = ['/agenda']; // rotas que renderizam o próprio shell e topbar — escondem TopbarV2 + padding
const SIDEBAR_COLLAPSED_KEY = 'la-sidebar-collapsed';

function isAgendaRoute(pathname: string): boolean {
  return AGENDA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isFullscreenRoute(pathname: string): boolean {
  return FULLSCREEN_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
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
  const isTablet = bp === 'tablet';

  // Estado de colapso controlado pelo usuário (desktop apenas). Tablet força true.
  // Persistido em localStorage para sobreviver entre navegações/sessões.
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  });
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(userCollapsed));
  }, [userCollapsed]);

  const collapsed = isTablet || userCollapsed;
  const sidebarWidth = collapsed ? 64 : 240;
  const showAgendaTabs = isAgendaRoute(pathname);
  const fullscreen = isFullscreenRoute(pathname);

  // Realtime sync com Supabase — mantém TanStack atualizado quando o TOM
  // escreve no banco via WhatsApp.
  const { collaborator } = useAuth();
  useRealtimeSync(collaborator?.id);

  return (
    // Shell fixo no viewport — sempre ocupa exatamente 100% da janela.
    // Sidebar e Topbar são fixed; main é absolute e rola internamente.
    // Padrão desktop app (Linear, Notion, Stripe): janela do shell não cresce
    // com o conteúdo — só o painel <main> rola. Garante zero vazio embaixo.
    <div className="fixed inset-0 bg-bg-app text-fg overflow-hidden">
      <SidebarV2
        collapsed={collapsed}
        onToggleCollapse={isTablet ? undefined : () => setUserCollapsed(v => !v)}
      />
      {!fullscreen && <TopbarV2 sidebarCollapsed={collapsed} />}
      <main
        className={[
          'absolute right-0 bottom-0 overflow-y-auto flex flex-col',
          fullscreen ? 'top-0' : 'top-14',
        ].join(' ')}
        style={{ left: sidebarWidth }}
      >
        {showAgendaTabs && !fullscreen && (
          <div className="w-full px-6 lg:px-10 pt-6 shrink-0">
            <AgendaTabs />
          </div>
        )}
        {/* Em rotas fullscreen (/agenda) — sem padding wrapper: a screen controla 100% da área */}
        <div
          className={[
            'w-full flex-1 min-h-0',
            fullscreen ? '' : 'px-4 md:px-6 lg:px-10 py-6',
          ].join(' ')}
        >
          <Outlet />
        </div>
      </main>
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      <ToastHost />
    </div>
  );
}
