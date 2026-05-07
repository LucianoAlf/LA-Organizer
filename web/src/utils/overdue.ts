// Sprint 22.23 (refactor) — extraido de screens/ProjetoDetalhe.tsx.
// Helpers de "data de hoje em SP" e "atrasada ha quantos dias".

/** YYYY-MM-DD em fuso de Sao Paulo. */
export function todaySP(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    .toISOString().slice(0, 10);
}

/** Dias entre hoje (SP, meia-noite) e a due_date. >=0. */
export function daysOverdue(dueDateYmd: string): number {
  try {
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const [y, m, d] = dueDateYmd.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    const diffMs = today.setHours(0, 0, 0, 0) - due.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor(diffMs / 86400000));
  } catch { return 0; }
}
