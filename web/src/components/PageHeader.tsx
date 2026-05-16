import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Destino do voltar. Quando passado, SEMPRE prevalece sobre navigate(-1)
   *  pra evitar loops em fluxos tipo Lista→Detalhe→Filho→Detalhe→Filho. */
  backTo?: string;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, backTo, right }: PageHeaderProps) {
  const navigate = useNavigate();

  function handleBack() {
    // Se backTo explícito → navegação determinística (não confia no history).
    if (backTo !== undefined) {
      navigate(backTo);
      return;
    }
    // Sem backTo → tenta history back; fallback /mais.
    const idx = (window.history.state && (window.history.state.idx as number | undefined)) ?? 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate('/mais');
    }
  }

  return (
    <header className="flex items-start justify-between gap-md mb-md">
      <div className="flex items-start gap-sm min-w-0 flex-1">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Voltar"
          className="-ml-2 mt-0.5 h-9 w-9 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring shrink-0"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-section-title leading-tight">{title}</h2>
          {subtitle && <p className="text-body-sm text-fg-muted mt-1">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
