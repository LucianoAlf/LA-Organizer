// web/src/components/WatchedTasksSection.tsx
// Tarefas em que estou "em cópia" (acompanho e cobro, não concluo). Auto-contido:
// só renderiza quando há itens. Não polui as abas Trabalho/Delegadas.
import { useWatchedTasks } from '../hooks/useWatchedTasks';

function fmtDay(ymd: string | null): string {
  if (!ymd) return 'sem prazo';
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export function WatchedTasksSection() {
  const q = useWatchedTasks(true);
  const items = q.data ?? [];
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-label uppercase tracking-wide text-fg-muted">Em cópia · acompanhando</h2>
      <ul className="space-y-1.5">
        {items.map(t => (
          <li key={t.id} className="rounded-md border border-border bg-bg-elevated px-3 py-2">
            <div className="text-body text-fg font-medium">{t.title}</div>
            <div className="text-body-sm text-fg-muted">
              {t.executor_name ? `${t.executor_name} · ` : ''}{fmtDay(t.due_date)} · em cópia
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
