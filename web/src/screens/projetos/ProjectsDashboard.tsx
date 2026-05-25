import { useMemo } from 'react';
import { Rocket, Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Project, ProjectCategory } from '../../types';
import { KANBAN_COLUMNS, CATEGORY_BADGE } from './constants';
import { KpiCard } from '../../components/KpiCard';

interface ProjectsDashboardProps {
  projects: Project[];
}

interface HorizontalBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
  badge?: string;
}

function HorizontalBar({ label, count, total, color }: HorizontalBarProps) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 shrink-0 text-[12px] text-fg-secondary truncate">{label}</div>
      <div className="flex-1 h-2 rounded-full bg-bg-app overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-10 shrink-0 text-right text-[12px] font-bold text-fg tabular-nums">{count}</div>
    </div>
  );
}

export function ProjectsDashboard({ projects }: ProjectsDashboardProps) {
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let urgent = 0; // projetos com end_date nos próximos 7 dias

    const now = Date.now();
    const sevenDays = 7 * 86400000;

    for (const p of projects) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
      if (p.end_date) {
        const end = new Date(p.end_date).getTime();
        if (end - now > 0 && end - now < sevenDays && p.status !== 'completed' && p.status !== 'cancelled') {
          urgent++;
        }
      }
    }

    return {
      total: projects.length,
      planning: byStatus.planning ?? 0,
      active: byStatus.active ?? 0,
      completed: byStatus.completed ?? 0,
      paused: byStatus.paused ?? 0,
      pendingApproval: byStatus.pending_approval ?? 0,
      urgent,
      byStatus,
      byCategory,
    };
  }, [projects]);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total ativos" value={stats.total} Icon={Rocket} accentColor="#60a5fa" />
        <KpiCard label="Em andamento" value={stats.active} Icon={Activity} accentColor="#A3BE50" />
        <KpiCard label="Concluídos" value={stats.completed} Icon={CheckCircle2} accentColor="#22C55E" />
        <KpiCard
          label="Urgentes (7d)"
          value={stats.urgent}
          Icon={AlertTriangle}
          accentColor={stats.urgent > 0 ? '#EF4444' : '#9E9E9E'}
        />
      </div>

      {/* Pipeline Status + Categoria Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline */}
        <section className="rounded-xl border border-border bg-bg-surface p-5">
          <header className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-semibold text-fg">Pipeline por status</h3>
            <span className="text-[11px] text-fg-muted">{stats.total} projetos</span>
          </header>
          <div className="space-y-3">
            {KANBAN_COLUMNS.map(col => (
              <HorizontalBar
                key={col.id}
                label={col.title}
                count={stats.byStatus[col.id] ?? 0}
                total={stats.total}
                color={col.accentColor}
              />
            ))}
          </div>
        </section>

        {/* Categorias */}
        <section className="rounded-xl border border-border bg-bg-surface p-5">
          <header className="flex items-center justify-between mb-4">
            <h3 className="text-[13px] font-semibold text-fg">Distribuição por categoria</h3>
            <span className="text-[11px] text-fg-muted">
              {Object.keys(stats.byCategory).length} categorias
            </span>
          </header>
          <div className="space-y-3">
            {(Object.keys(CATEGORY_BADGE) as ProjectCategory[]).map(cat => {
              const meta = CATEGORY_BADGE[cat];
              return (
                <HorizontalBar
                  key={cat}
                  label={meta.label}
                  count={stats.byCategory[cat] ?? 0}
                  total={stats.total}
                  color={meta.base}
                />
              );
            })}
          </div>
        </section>
      </div>

      {/* Resumo textual no rodapé */}
      <section className="rounded-xl border border-border bg-bg-surface p-5">
        <header className="mb-3">
          <h3 className="text-[13px] font-semibold text-fg">Resumo</h3>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[12px] text-fg-secondary">
          <div>
            <div className="text-fg-muted text-[10px] uppercase tracking-wider font-semibold mb-1">
              Aguardando aprovação
            </div>
            <div className="text-[20px] font-bold text-warning tabular-nums">
              {stats.pendingApproval}
            </div>
          </div>
          <div>
            <div className="text-fg-muted text-[10px] uppercase tracking-wider font-semibold mb-1">
              Em planejamento
            </div>
            <div className="text-[20px] font-bold text-fg tabular-nums">{stats.planning}</div>
          </div>
          <div>
            <div className="text-fg-muted text-[10px] uppercase tracking-wider font-semibold mb-1">
              Pausados
            </div>
            <div className="text-[20px] font-bold text-fg tabular-nums">{stats.paused}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
