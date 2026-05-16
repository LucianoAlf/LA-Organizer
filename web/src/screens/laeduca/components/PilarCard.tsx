import { Link } from 'react-router-dom';
import { BookOpen, Music, Users, School, GraduationCap, Heart, Star, Target, Award, Briefcase, type LucideIcon } from 'lucide-react';

const ICONS_MAP: Record<string, LucideIcon> = {
  BookOpen, Music, Users, School, GraduationCap, Heart, Star, Target, Award, Briefcase,
};

interface Props {
  pilarCodigo: string;   // 'p1', etc — usado em URL
  pilarNome: string;
  iconeName: string;     // 'BookOpen' etc
  ancorados: number;
  total: number;
  to: string;
}

export function PilarCard({ pilarCodigo: _pilarCodigo, pilarNome, iconeName, ancorados, total, to }: Props) {
  const Icon = ICONS_MAP[iconeName] ?? BookOpen;
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
          <h3 className="font-semibold text-fg">{pilarNome}</h3>
          <div className="text-body-sm text-fg-muted mt-1">
            {ancorados} de {total} ancorados · {pct}%
          </div>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded ${badgeClass} font-semibold`}>{status}</span>
      </div>
    </Link>
  );
}
