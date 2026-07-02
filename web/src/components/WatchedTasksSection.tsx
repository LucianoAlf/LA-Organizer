// web/src/components/WatchedTasksSection.tsx
// Tarefas em que estou "em cópia" (acompanho e cobro, não concluo). Auto-contido:
// só renderiza quando há itens. Não polui as abas Trabalho/Delegadas.
// Devolutiva (2026-07-02): aqui o usuário é SEMPRE watcher → sempre pode deixar devolutiva
// pra quem delegou (+ executor). Escreve via internal-api (service_role).
import { useWatchedTasks } from '../hooks/useWatchedTasks';
import { useAuth } from '../contexts/AuthContext';
import { TaskReturnSection } from './TaskReturnSection';

function fmtDay(ymd: string | null): string {
  if (!ymd) return 'sem prazo';
  const [, m, d] = ymd.split('-');
  return `${d}/${m}`;
}

export function WatchedTasksSection() {
  const q = useWatchedTasks(true);
  const { collaborator } = useAuth();
  const meId = collaborator?.id ?? null;
  const items = q.data ?? [];
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-label uppercase tracking-wide text-fg-muted">Em cópia · acompanhando</h2>
      <ul className="space-y-1.5">
        {items.map(t => (
          <li key={t.id} className="rounded-md border border-border bg-bg-elevated px-3 py-2 space-y-2">
            <div>
              <div className="text-body text-fg font-medium">{t.title}</div>
              <div className="text-body-sm text-fg-muted">
                {t.executor_name ? `${t.executor_name} · ` : ''}{fmtDay(t.due_date)} · em cópia
              </div>
            </div>
            {meId && <TaskReturnSection taskId={t.id} meId={meId} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
