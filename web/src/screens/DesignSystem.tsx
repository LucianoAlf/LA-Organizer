import { useEffect } from 'react';

/**
 * Rota interna /design-system — living styleguide.
 *
 * Fase 1b.1: embute o mockup standalone copiado pra web/public/mockups/.
 * Funciona em dev (vite dev), preview (vite preview) e prod (Vercel).
 * Conforme primitivos React forem implementados (1b.2+), o iframe será
 * substituído por renderização real dos componentes.
 */
export function DesignSystem() {
  useEffect(() => {
    document.title = 'Design System · LA Organizer';
  }, []);

  return (
    <div className="fixed inset-0">
      <iframe
        src="/mockups/01-tokens.html"
        title="LA Organizer Design System"
        className="w-full h-full border-0"
      />
    </div>
  );
}
