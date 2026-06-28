// EVENT-RESCHED-REMINDER-PWA (28/06) — gêmeo PWA do fix do engine.
// Ao REAGENDAR um evento no app (mudar start_at), os lembretes (datetime-local
// absolutos) precisam acompanhar o novo horário, preservando o offset (T-15min
// continua T-15min do novo start). Espelha shiftRemindersByReschedule do engine
// (src/services/reschedule-reminders.js), mas opera em strings datetime-local SP.
// PURA: o componente chama no onChange do start; o save de cada tela persiste o
// resultado (EditEventSheet via diff, EventEditDrawer via useReminders.sync).

// "YYYY-MM-DDTHH:MM" — o new Date() do JS é leniente demais ("xx", "lixo" parseiam
// pra datas válidas), então validamos o FORMATO antes de parsear.
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** "YYYY-MM-DDTHH:MM" (SP -03:00) → ms epoch. NaN se formato inválido ou data inválida. */
function localToMs(local: string): number {
  if (typeof local !== 'string' || !LOCAL_RE.test(local)) return NaN;
  return new Date(`${local}:00-03:00`).getTime();
}

/** ms epoch → "YYYY-MM-DDTHH:MM" no fuso SP (-03:00 fixo, sem DST no Brasil). */
function msToLocal(ms: number): string {
  return new Date(ms - 3 * 3600_000).toISOString().slice(0, 16);
}

/**
 * Desloca cada lembrete pelo MESMO delta (newStart - oldStart), preservando o
 * offset relativo ao início (T-15 continua T-15 do novo horário).
 *
 * Diferença DELIBERADA do engine: não inventa lembrete (lista vazia → vazia). No
 * PWA o usuário VÊ a lista; vazio é estado explícito, então não há ensure-pending
 * (o engine é cego e por isso garante um default). Também não há guard de passado:
 * espelha o engine (reschedule pra mais cedo desloca pra trás), evitando divergência
 * TOM↔app — um piso, se desejado, deve ser compartilhado nos dois caminhos.
 *
 * Se old/new start forem inválidos, ou delta 0, retorna a lista inalterada.
 * Lembrete individual inválido é mantido como está.
 */
export function shiftLocalReminderTimes(
  times: string[],
  oldStartLocal: string,
  newStartLocal: string,
): string[] {
  const oldMs = localToMs(oldStartLocal);
  const newMs = localToMs(newStartLocal);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs)) return times;
  const delta = newMs - oldMs;
  if (delta === 0) return times;
  return times.map((t) => {
    const ms = localToMs(t);
    if (!Number.isFinite(ms)) return t;
    return msToLocal(ms + delta);
  });
}

/**
 * Versão ROW/ISO do shift, pro caminho de DRAG-reschedule (AgendaDesktop.onEventDrop),
 * que opera direto nas rows de event_reminders (não na lista datetime-local da UI).
 * Espelha EXATAMENTE shiftRemindersByReschedule do engine: desloca cada row pelo delta
 * (newStart - oldStart). O caller passa SÓ as rows PENDENTES (sent_at IS NULL) — as já
 * enviadas ficam intactas como histórico, igual o engine. Retorna [] se delta 0 ou start
 * inválido. Row com remind_at inválido é pulada.
 */
export function shiftReminderRowsByReschedule(
  rows: Array<{ id: string; remind_at: string }>,
  oldStartIso: string,
  newStartIso: string,
): Array<{ id: string; remind_at: string }> {
  const oldMs = Date.parse(oldStartIso);
  const newMs = Date.parse(newStartIso);
  if (!Number.isFinite(oldMs) || !Number.isFinite(newMs)) return [];
  const delta = newMs - oldMs;
  if (delta === 0) return [];
  const out: Array<{ id: string; remind_at: string }> = [];
  for (const r of rows || []) {
    const rm = Date.parse(r && r.remind_at);
    if (!Number.isFinite(rm)) continue;
    out.push({ id: r.id, remind_at: new Date(rm + delta).toISOString() });
  }
  return out;
}
