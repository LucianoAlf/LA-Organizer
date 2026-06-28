// Hook genérico pra carregar e sincronizar lembretes (event OU task).
// Encapsula:
//   - Query de SELECT na tabela `event_reminders` ou `task_reminders`
//   - Função `sync(localTimes[])` que faz DELETE-all + INSERT-new
//     (estratégia simples; volume de lembretes por entidade é pequeno)
//
// As tabelas têm estrutura idêntica (event_id/task_id, remind_at, sent_at, label).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../../../lib/supabase';

type Kind = 'event' | 'task';

interface ReminderRow {
  id: string;
  remind_at: string;
  sent_at: string | null;
}

/** Converte datetime-local "YYYY-MM-DDTHH:MM" → ISO com offset -03:00 (SP). */
function localToIso(local: string): string {
  return `${local}:00-03:00`;
}

/** Converte ISO → datetime-local SP "YYYY-MM-DDTHH:MM". */
function isoToLocal(iso: string): string {
  const sp = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return sp.toISOString().slice(0, 16);
}

function tableFor(kind: Kind): 'event_reminders' | 'task_reminders' {
  return kind === 'event' ? 'event_reminders' : 'task_reminders';
}
function fkFor(kind: Kind): 'event_id' | 'task_id' {
  return kind === 'event' ? 'event_id' : 'task_id';
}

export function useReminders(kind: Kind, entityId: string | null | undefined, opts?: { pendingOnly?: boolean }) {
  // pendingOnly (usado só pelo EventEditDrawer): opera apenas em lembretes não-enviados,
  // espelhando o engine (event_reminders sent_at IS NULL). Task (sem o flag) mantém o
  // comportamento antigo; o re-fire de task é blindado pelo guard de staleness do dispatcher.
  const pendingOnly = opts?.pendingOnly ?? false;
  const qc = useQueryClient();
  const table = tableFor(kind);
  const fk = fkFor(kind);

  const { data, isLoading } = useQuery({
    queryKey: ['reminders', kind, entityId],
    enabled: Boolean(entityId && supabaseConfigured),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table)
        .select('id, remind_at, sent_at')
        .eq(fk, entityId!)
        .order('remind_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReminderRow[];
    },
  });

  /** Lista de datetime-local pra alimentar o RemindersField. */
  const localTimes: string[] = (data ?? [])
    .filter(r => !pendingOnly || r.sent_at == null)
    .map(r => isoToLocal(r.remind_at));

  /** Sincroniza: deleta todos + insere novos. */
  async function sync(newLocalTimes: string[]) {
    if (!entityId) return;
    // 1. Delete existing. Com pendingOnly (event), deleta SÓ os não-enviados, preservando
    //    o histórico (sent_at != null) — espelha o engine. Sem o flag (task), DELETE-all.
    let delQuery = supabase.from(table).delete().eq(fk, entityId);
    if (pendingOnly) delQuery = delQuery.is('sent_at', null);
    const { error: delErr } = await delQuery;
    if (delErr) throw delErr;
    // 2. Insert new (se houver)
    if (newLocalTimes.length > 0) {
      const rows = newLocalTimes.map(local => ({
        [fk]: entityId,
        remind_at: localToIso(local),
      }));
      const { error: insErr } = await supabase.from(table).insert(rows);
      if (insErr) throw insErr;
    }
    // 3. Invalidate cache
    qc.invalidateQueries({ queryKey: ['reminders', kind, entityId] });
  }

  return { localTimes, isLoading, sync };
}
