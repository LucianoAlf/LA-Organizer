// INSTANCIA-PWA-SEM-LEMBRETE (Duda 08/09/2026) — espelho de `_cloneRemindersForInstances` do
// backend (src/services/recurrence-engine.js). O PWA materializa as instâncias na hora, mas não
// copiava os lembretes do molde: as 28 "Vitaminas e ferro do Vicente" nasceram sem nenhum, e
// lembrete de evento só sai por `event_reminders` (`events.remind_at` é só exibição).
// PURA: calcula as linhas; quem grava é materializeSeriesClient.

export interface LembreteDoMolde {
  remind_at: string;
  label: string | null;
}

export interface InstanciaCriada {
  id: string;
  due_date?: string;
  start_at?: string;
}

/**
 * Para cada instância, os lembretes do molde deslocados pela mesma distância da âncora
 * (00:00 BRT do dia pra tarefa, `start_at` pra evento). Pula o que já existe (idempotente).
 */
export function planejaLembretesDeInstancias(
  table: 'tasks' | 'events',
  template: { due_date?: unknown; start_at?: unknown },
  lembretesDoMolde: LembreteDoMolde[],
  instancias: InstanciaCriada[],
  jaExistentes: Array<{ id: string; remind_at: string }> = [],
): Array<Record<string, string | null>> {
  const fk = table === 'tasks' ? 'task_id' : 'event_id';
  const ancora = (v: unknown) =>
    table === 'tasks' ? new Date(`${String(v)}T00:00:00-03:00`) : new Date(String(v));
  const tplAnchor = ancora(table === 'tasks' ? template.due_date : template.start_at);
  if (isNaN(tplAnchor.getTime())) return [];
  const existe = new Set(
    jaExistentes
      .filter((r) => r && r.remind_at && !isNaN(new Date(r.remind_at).getTime()))
      .map((r) => `${r.id}:${new Date(r.remind_at).toISOString()}`),
  );
  const out: Array<Record<string, string | null>> = [];
  for (const inst of instancias ?? []) {
    const instAnchor = ancora(table === 'tasks' ? inst.due_date : inst.start_at);
    if (isNaN(instAnchor.getTime())) continue;
    for (const r of lembretesDoMolde ?? []) {
      const t = new Date(r.remind_at);
      if (isNaN(t.getTime())) continue;
      const novo = new Date(instAnchor.getTime() + (t.getTime() - tplAnchor.getTime())).toISOString();
      if (existe.has(`${inst.id}:${novo}`)) continue;
      out.push({ [fk]: inst.id, remind_at: novo, label: r.label ?? null });
    }
  }
  return out;
}
