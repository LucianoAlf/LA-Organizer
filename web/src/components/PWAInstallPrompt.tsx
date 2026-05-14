// Sprint 23.7+ — Install prompt UX (enhanced)
//
// Três casos cobertos:
//   1. Chrome Android com beforeinstallprompt  → banner com botão "Instalar"
//   2. iOS Safari                              → instruções "Compartilhar → Adicionar à tela"
//   3. Chrome Android sem beforeinstallprompt  → fallback após 3s: "menu ⋮ → Adicionar"
//      (acontece quando o Chrome considera o app já instalado ou heurísticas não cumpridas)
//
// Login e AppShell são mutuamente exclusivos na árvore React (auth guard),
// então a dupla presença do componente não cria instâncias concorrentes.
import { useEffect, useRef, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa-install-dismissed-at';
const DISMISS_COOLDOWN_DAYS = 7;
const FALLBACK_DELAY_MS = 3000;

function wasRecentlyDismissed(): boolean {
  try {
    const at = localStorage.getItem(DISMISS_KEY);
    if (!at) return false;
    return Date.now() - Number(at) < DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  );
}

type PromptState = 'hidden' | 'native' | 'ios' | 'android-manual';

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<PromptState>('hidden');
  const promptCaptured = useRef(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (wasRecentlyDismissed()) return;

    // iOS Safari não tem beforeinstallprompt — mostra instruções manuais imediatamente
    if (isIOS()) {
      setState('ios');
      return;
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      promptCaptured.current = true;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setState('native');
    }

    function onInstalled() {
      setDeferredPrompt(null);
      setState('hidden');
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Se o Chrome não disparar beforeinstallprompt em 3s (app já instalado
    // em estado quebrado, ou heurísticas não cumpridas), mostra rota manual.
    const timer = setTimeout(() => {
      if (!promptCaptured.current) {
        setState('android-manual');
      }
    }, FALLBACK_DELAY_MS);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(timer);
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
    setState('hidden');
  }

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setState('hidden');
  }

  if (state === 'hidden') return null;

  const bannerClass =
    'fixed bottom-20 left-md right-md z-50 mx-auto max-w-md surface p-md shadow-lg border border-tom/40 flex items-start gap-md';

  // ── 1. Chrome Android: botão de instalação nativa ──────────────────────────
  if (state === 'native') {
    return (
      <div role="alert" className={bannerClass}>
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

  // ── 2. iOS Safari: instruções manuais ─────────────────────────────────────
  if (state === 'ios') {
    return (
      <div role="alert" className={bannerClass}>
        <div className="shrink-0 mt-1 text-tom">
          <Share size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-body-md font-semibold text-fg">Instalar LA Organizer</div>
          <div className="text-body-sm text-fg-muted mt-0.5">
            Toque em <strong className="text-fg">Compartilhar</strong>{' '}
            <span aria-hidden>⬆</span> (barra inferior) →{' '}
            <strong className="text-fg">Adicionar à tela de início</strong>.
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="mt-md h-8 px-3 rounded-md bg-bg-elevated text-fg-muted text-body-sm border border-border focus-ring"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  // ── 3. Android sem beforeinstallprompt: menu manual ───────────────────────
  if (state === 'android-manual') {
    return (
      <div role="alert" className={bannerClass}>
        <div className="shrink-0 mt-1 text-tom">
          <Download size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-body-md font-semibold text-fg">Instalar LA Organizer</div>
          <div className="text-body-sm text-fg-muted mt-0.5">
            No Chrome, toque no menu{' '}
            <strong className="text-fg">⋮</strong> →{' '}
            <strong className="text-fg">Adicionar à tela inicial</strong>.
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="mt-md h-8 px-3 rounded-md bg-bg-elevated text-fg-muted text-body-sm border border-border focus-ring"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return null;
}
