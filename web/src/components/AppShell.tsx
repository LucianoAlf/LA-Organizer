import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { AgendaTabs } from './AgendaTabs';
import { PWAUpdatePrompt } from './PWAUpdatePrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { ToastHost } from './Toast';
import { OnboardingWizard, WIZARD_DISMISSED_KEY } from './OnboardingWizard';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

const FOCUSED_FLOW_PATHS = ['/projetos/novo'];
const AGENDA_PATHS = ['/hoje', '/semana', '/mes'];

function isFocusedFlow(pathname: string): boolean {
  return FOCUSED_FLOW_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isAgendaRoute(pathname: string): boolean {
  return AGENDA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function AppShell() {
  const { pathname } = useLocation();
  const { collaborator } = useAuth();
  const focused = isFocusedFlow(pathname);
  const showAgendaTabs = isAgendaRoute(pathname);

  // Realtime sync com Supabase — invalida TanStack quando TOM escreve no banco.
  // Sem isso, mudanças via WhatsApp só aparecem no PWA após staleTime + interação.
  useRealtimeSync(collaborator?.id);

  // Wizard: mostra se onboarding não concluído E usuário ainda não dispensou nesta sessão/localStorage
  const [wizardDismissed, setWizardDismissed] = useState(
    () => localStorage.getItem(WIZARD_DISMISSED_KEY) === 'true'
  );

  const showWizard =
    collaborator !== null &&
    !collaborator.onboarding_completed &&
    !wizardDismissed;

  if (showWizard) {
    return <OnboardingWizard onDismiss={() => setWizardDismissed(true)} />;
  }

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
