import { StatCard } from '../../../components/StatCard';
import type { NoteLike } from '../../../lib/groupNotes';

export function NotesSummary({ notes }: { notes: NoteLike[] }) {
  const acessos = notes.filter(n => n.type === 'acesso').length;
  const contas = notes.filter(n => n.type === 'conta').length;
  const fixadas = notes.filter(n => n.pinned).length;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-sm">
      <StatCard label="Fichas" value={notes.length} tone="neutral" />
      <StatCard label="Acessos" value={acessos} tone="neutral" />
      <StatCard label="Contas" value={contas} tone="neutral" />
      <StatCard label="Fixadas" value={fixadas} tone={fixadas > 0 ? 'success' : 'neutral'} />
    </div>
  );
}
