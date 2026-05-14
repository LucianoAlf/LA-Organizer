// Sprint 23.7 — Install prompt UX
// Substitui o "engagement heuristic" do Chrome (que pode demorar dias pra
// disparar o prompt nativo) por um banner explícito. Escuta o evento
// `beforeinstallprompt`, guarda dismissal em localStorage para não importunar.
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa-install-dismissed-at';
const DISMISS_COOLDOWN_DAYS = 7;

function wasRecentlyDismissed(): boolean {
  const at = localStorage.getItem(DISMISS_KEY);
  if (!at) return false;
  const elapsed = Date.now() - Number(at);
  return elapsed < DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Se já está instalado (standalone display mode), não mostrar.
    if (isStandalone()) return;
    if (wasRecentlyDismissed()) return;

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShow(true);
    }

    function onInstalled() {
      setShow(false);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'dismissed') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setDeferredPrompt(null);
    setShow(false);
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  if (!show || !deferredPrompt) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-20 left-md right-md z-50 mx-auto max-w-md surface p-md shadow-lg border border-tom/40 flex items-start gap-md"
    >
      <div className="shrink-0 mt-1 text-tom">
        <Download size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-body-md font-semibold text-fg">Instalar LA Organizer</div>
        <div className="text-body-sm text-fg-muted mt-0.5">
          Adiciona o app na tela inicial — abre em segundos, sem barra de navegador.
        </div>
        <div className="mt-md flex gap-2">
          <button
            type="button"
            onClick={handleInstall}
            className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring"
          >
            Instalar
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="h-9 px-3 rounded-md bg-bg-elevated text-fg-muted text-body-sm border border-border focus-ring"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
