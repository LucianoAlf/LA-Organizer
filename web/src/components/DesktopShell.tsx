import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ToastHost } from './Toast';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

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
  const collapsed = bp === 'tablet';
  const sidebarWidth = collapsed ? 64 : 240;

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
        {/* Fase D2 — desktop libera largura para max-w-5xl (1024px); mobile/tablet
            mantem max-w-content (720px) para preservar legibilidade. */}
        <div className="w-full max-w-content lg:max-w-5xl mx-auto px-4 lg:px-6 py-4">
          <Outlet />
        </div>
      </main>
      <PWAUpdatePrompt />
      <PWAInstallPrompt />
      <ToastHost />
    </div>
  );
}
