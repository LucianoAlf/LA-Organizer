import { Video, MapPin, Building2 } from 'lucide-react';
import type { EventForGrid } from '../../hooks/useAgendaEvents';

/**
 * Single-line compact event row para o painel esquerdo desktop (400px).
 * Layout: [checkbox] [eisenhower dot] [HH:MM] [title truncated] [badge categoria] [icon modalidade]
 * Espelha o mockup B refinado — uma linha por compromisso.
 */
interface Props {
  event: EventForGrid;
  onClick: () => void;
  onToggleDone?: () => void;
}

const CATEGORY_TONE: Record<string, string> = {
  la_music: 'bg-tom/20 text-tom border-tom/30',
  mentoria: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  aula_particular: 'bg-info/20 text-info border-info/30',
  outra_escola: 'bg-warning/20 text-warning border-warning/30',
  estudio: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  pessoal: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
};

const CATEGORY_FULL: Record<string, string> = {
  la_music: 'LA Music',
  mentoria: 'Mentoria',
  aula_particular: 'Aula',
  outra_escola: 'Escola',
  estudio: 'Estúdio',
  pessoal: 'Pessoal',
};

function formatHM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function CompactEventRow({ event, onClick, onToggleDone }: Props) {
  const isDone = event.status === 'done';
  const isCancelled = event.status === 'cancelled';
  const slug = event.category;
  const catLabel = CATEGORY_FULL[slug] ?? slug;
  const catTone = CATEGORY_TONE[slug] ?? 'bg-bg-elevated text-fg-muted border-border';
  const ModalityIcon = event.modality === 'online' ? Video : event.modality === 'hibrido' ? Building2 : MapPin;

  return (
    <div className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-elevated min-w-0">
      <input
        type="checkbox"
        checked={isDone}
        onChange={(e) => { e.stopPropagation(); onToggleDone?.(); }}
        disabled={isCancelled || !onToggleDone}
        className={[
          'w-3.5 h-3.5 accent-tom shrink-0',
          onToggleDone && !isCancelled ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
        ].join(' ')}
        aria-label="Marcar como feito"
      />
      <span className="text-[11px] text-fg-muted tabular-nums shrink-0 font-medium">{formatHM(event.start_at)}</span>
      <button
        type="button"
        onClick={onClick}
        className={[
          'flex-1 text-left text-[12px] truncate focus-ring rounded',
          isDone || isCancelled ? 'text-fg-muted line-through' : 'text-fg',
        ].join(' ')}
      >
        {event.title}
      </button>
      {catLabel && (
        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border max-w-[100px] truncate ${catTone}`}>
          {catLabel}
        </span>
      )}
      <ModalityIcon size={11} className="shrink-0 text-fg-muted" aria-hidden />
    </div>
  );
}
