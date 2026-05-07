// Sprint 22.24 (refactor) — extraido de screens/NovoProjeto.tsx.
// Helpers de data usados pelo wizard de criacao de projeto.

/** YYYY-MM-DD em fuso de Sao Paulo (UTC-3 fixo). */
export function todayISO(): string {
  const d = new Date();
  const sp = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return sp.toISOString().slice(0, 10);
}

/** YYYY-MM-DD -> DD/MM/YYYY. Vazio retorna "—". */
export function formatBR(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** YYYY-MM-DD -> DD/MM (sem ano). Vazio retorna "—". */
export function formatBRShort(iso: string): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
