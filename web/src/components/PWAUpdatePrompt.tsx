// Sprint 11.2 hotfix — Bug observado: user via task sem ⏰ no PWA porque o Service
// Worker servia bundle antigo (BGD_5Q8f.js, pré-Sprint 11) mesmo após deploys novos.
// Causa-raiz: registerType 'autoUpdate' INSTALA o novo SW, mas só ativa quando
// todas as abas fecham. Combinado com skipWaiting+clientsClaim no workbox + este
// prompt UI que escuta `onNeedRefresh` do useRegisterSW e oferece "atualizar agora",
// fechamos o ciclo: deploy → SW detecta → prompt aparece → 1 clique → bundle novo.
import { useState, useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';

// Idempotente entre remounts do shell (mobile↔desktop no resize): só instala
// UM checker por sessão de página, senão acumula intervalos/listeners duplicados.
let checkerInstalled = false;

export function PWAUpdatePrompt() {
  const [show, setShow] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // Detecta nova versão SEM precisar navegar/fechar abas. Antes era polling de
      // 60min → lento demais pro fluxo "deployei agora, quero ver". Aí o user ia no
      // DevTools e dava "Clear site data" — que apaga o localStorage e DESLOGA
      // (a sessão do Supabase mora lá). Resolver o cache direito mata os dois.
      if (!registration || checkerInstalled) return;
      checkerInstalled = true;
      const check = () => registration.update().catch(() => { /* offline-tolerant */ });
      // 1) a cada 60s (sw.js é minúsculo — custo desprezível)
      setInterval(check, 60 * 1000);
      // 2) IMEDIATO quando a aba volta a ficar visível (alt-tab pós-deploy → vê na hora)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  useEffect(() => {
    if (needRefresh) setShow(true);
  }, [needRefresh]);

  if (!show) return null;

  const handleUpdate = async () => {
    try {
      await updateServiceWorker(true);
      // updateServiceWorker(true) chama window.location.reload(). Se por algum
      // motivo não recarregar (raro), forçamos manualmente.
      setTimeout(() => window.location.reload(), 200);
    } catch (err) {
      console.error('[PWA] update err:', err);
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setShow(false);
    setNeedRefresh(false);
  };

  return (
    <div
      role="alert"
      className="fixed bottom-20 left-md right-md z-50 mx-auto max-w-md surface p-md shadow-lg border border-brand/40 flex items-start gap-md"
    >
      <div className="shrink-0 mt-1 text-brand">
        <RefreshCw size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-body-md font-semibold text-fg">Nova versão disponível</div>
        <div className="text-body-sm text-fg-muted mt-0.5">
          Atualize pra ver as últimas mudanças (horários, badges, hábitos).
        </div>
        <div className="mt-md flex gap-2">
          <button
            type="button"
            onClick={handleUpdate}
            className="h-9 px-3 rounded-md bg-brand text-white text-body-sm font-semibold focus-ring"
          >
            Atualizar agora
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="h-9 px-3 rounded-md bg-bg-elevated text-fg-muted text-body-sm border border-border focus-ring"
          >
            Depois
          </button>
        </div>
      </div>
    </div>
  );
}
