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
const SIDEBAR_COLLAPSED_KEY = 'la-sidebar-collapsed';

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
      <TopbarV2 sidebarCollapsed={collapsed} />
      <main
        className="absolute top-14 right-0 bottom-0 overflow-y-auto"
        style={{ left: sidebarWidth }}
      >
        {showAgendaTabs && (
          <div className="w-full px-6 lg:px-10 pt-6">
            <AgendaTabs />
          </div>
        )}
        <div className="w-full px-4 md:px-6 lg:px-10 py-6">
          <Outlet />
        </div>
      </main>
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      <ToastHost />
    </div>
  );
}
