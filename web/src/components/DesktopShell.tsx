import { useEffect, useState } from 'react';
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
    <div className="min-h-screen bg-bg-app text-fg">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={isTablet ? undefined : () => setUserCollapsed(v => !v)}
      />
      <Topbar sidebarCollapsed={collapsed} />
      <main
        className="pt-14 min-h-screen"
        style={{ marginLeft: sidebarWidth }}
      >
        {/* Tabs Dia/Semana — paridade com mobile. Renderizado no shell para que
            a MESMA instância persista entre /hoje ↔ /semana (indicador deslizante
            só anima se o elemento não for desmontado). */}
        {showAgendaTabs && (
          <div className="w-full px-6 lg:px-10 pt-6">
            <AgendaTabs />
          </div>
        )}
        {/* Fase D2.2 — conteúdo ocupa toda a largura disponível (sem max-w),
            respeitando apenas o padding lateral. Assim, recolher a sidebar
            de fato expande o conteúdo na mesma distância. */}
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
