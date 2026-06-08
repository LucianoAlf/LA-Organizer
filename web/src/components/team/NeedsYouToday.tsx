// web/src/components/team/NeedsYouToday.tsx
// Faixa "⚡ Precisa de você hoje" do CEO desktop (Fase 2 — Task 6).
// Deriva 2-4 itens de maior urgência cruzando 3 sinais:
//   • overdueByPerson (counts altos)         → "N atrasadas"
//   • noResponse (não respondeu o briefing)  → "Sem resposta hoje"
//   • líderes atenção c/ tasks_stuck >= 2     → "M tarefas travadas"
// Cada item leva ao drill da pessoa (/time/:id). Visual = faixa vermelha do mockup.
import { Link } from 'react-router-dom';
import { Zap, ChevronRight } from 'lucide-react';
import type { TeamSnapshot } from '../../lib/team-snapshot';
import type { LeaderScorecard } from '../../hooks/useLeaderScorecards';
import { classifyScorecard } from '../../lib/scorecard-classify';

interface Props {
  snapshot: TeamSnapshot;
  scorecards: LeaderScorecard[];
}

interface UrgentItem {
  id: string;
  name: string;
  reason: string;
  weight: number;
}

const MAX_ITEMS = 4;

export function NeedsYouToday({ snapshot, scorecards }: Props) {
  const { allCollabs, overdueByPerson, noResponse } = snapshot;

  const firstName = (id: string) =>
    allCollabs.find(c => c.id === id)?.preferred_name?.split(' ')[0] ||
    allCollabs.find(c => c.id === id)?.full_name?.split(' ')[0] ||
    id.slice(0, 6);

  // Acumula urgência por pessoa: o maior sinal define o motivo; o peso soma p/ ordenar.
  const byId = new Map<string, UrgentItem>();
  const bump = (id: string, reason: string, weight: number) => {
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { id, name: firstName(id), reason, weight });
      return;
    }
    prev.weight += weight;
    if (weight > 0) prev.reason = reason; // motivo mais forte ganha a label
  };

  // 1) Atrasos (peso = count, é o sinal mais "duro").
  for (const { assigned_to, count } of overdueByPerson) {
    if (count > 0) bump(assigned_to, `${count} atrasada${count > 1 ? 's' : ''}`, count * 10);
  }

  // 2) Líderes em atenção com travadas — sinaliza o gargalo de ensino.
  for (const sc of scorecards) {
    if (!sc.leader) continue;
    if (classifyScorecard(sc) === 'atencao' && sc.tasks_stuck >= 2) {
      bump(sc.leader.id, `${sc.tasks_stuck} tarefas travadas no time`, 100 + sc.tasks_stuck);
    }
  }

  // 3) Não respondeu o briefing hoje (sinal leve, só entra se sobrar vaga).
  for (const id of noResponse) bump(id, 'Sem resposta no briefing hoje', 1);

  const items = [...byId.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_ITEMS);

  if (items.length === 0) return null;

  return (
    <section className="rounded-md border border-danger/40 bg-danger/10 p-md">
      <div className="flex items-center gap-2 text-label uppercase tracking-wide text-danger">
        <Zap size={14} /> Precisa de você hoje
      </div>
      <ul className="mt-md space-y-2">
        {items.map(item => (
          <li key={item.id}>
            <Link
              to={`/time/${item.id}`}
              className="flex items-center gap-md rounded-md bg-bg-surface/60 px-3 py-2 hover:bg-bg-surface transition-colors focus-ring"
            >
              <span className="font-semibold text-fg shrink-0">{item.name}</span>
              <span className="text-body-sm text-fg-secondary truncate flex-1">{item.reason}</span>
              <ChevronRight size={16} className="text-fg-muted shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
