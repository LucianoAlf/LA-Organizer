// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Banner amber gradient acima das tabs pra navegar pro Dia D em projetos de evento.
// So renderiza quando project.category === 'event'.

import { ChevronRight } from 'lucide-react';
import type { ProjectFull } from '../types/projectDetail';

interface DiaDBannerProps {
  project: ProjectFull;
  active: boolean;
  onClick: () => void;
}

export function DiaDBanner({ project, active, onClick }: DiaDBannerProps) {
  if (project.category !== 'event') return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dia D — roteiro do evento"
      className={[
        'w-full inline-flex items-center justify-between gap-2 px-4 py-3 rounded-md border transition-all focus-ring text-left',
        active
          ? 'bg-gradient-to-r from-amber-500/30 to-amber-400/20 border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.15)]'
          : 'bg-gradient-to-r from-amber-500/10 to-amber-400/5 border-amber-400/30 hover:from-amber-500/20 hover:to-amber-400/10 hover:border-amber-400/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span aria-hidden className="text-xl shrink-0">🎯</span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-amber-300/80">Roteiro do evento</div>
          <div className="text-card-title text-amber-100">
            Dia D
            {project.event_date && (
              <span className="text-amber-200/70 font-normal ml-2 text-body-md tabular-nums">
                · {project.event_date.slice(8, 10)}/{project.event_date.slice(5, 7)}
              </span>
            )}
          </div>
        </div>
      </div>
      <ChevronRight size={18} className="text-amber-300/60 shrink-0" />
    </button>
  );
}
