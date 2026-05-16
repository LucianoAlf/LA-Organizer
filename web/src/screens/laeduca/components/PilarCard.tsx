import { Link } from 'react-router-dom';
import { BookOpen, Music, Users, School } from 'lucide-react';
import type { PilarId } from '../../../lib/laeduca-types';
import { PILAR_NOMES } from '../../../lib/laeduca-types';

const ICONS: Record<PilarId, typeof BookOpen> = {
  p1: BookOpen,
  p2: Music,
  p3: Users,
  p4: School,
};

interface Props {
  pilar: PilarId;
  ancorados: number;
  total: number;
  to: string;
}

export function PilarCard({ pilar, ancorados, total, to }: Props) {
  const Icon = ICONS[pilar];
  const pct = total === 0 ? 0 : Math.round((ancorados / total) * 100);
  const status = ancorados === 0 ? 'Não iniciado' : ancorados === total ? 'Concluído' : 'Em andamento';
  const badgeClass =
    ancorados === total
      ? 'bg-success/15 text-success'
      : ancorados === 0
        ? 'bg-bg-app text-fg-muted'
        : 'bg-warning/15 text-warning';

  return (
    <Link
      to={to}
      className="block bg-bg-surface rounded-lg p-md border border-border hover:border-tom focus-ring transition-colors"
    >
      <div className="flex items-start gap-md">
        <div className="p-2 bg-tom/10 text-tom rounded-md">
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-fg">{PILAR_NOMES[pilar]}</h3>
          <div className="text-body-sm text-fg-muted mt-1">
            {ancorados} de {total} ancorados · {pct}%
          </div>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded ${badgeClass} font-semibold`}>{status}</span>
      </div>
    </Link>
  );
}
