// EVENTO-CRIADO-NO-PASSADO (Alf 05/10 19:14 BRT): "Mentoria Levi" foi criada pelo app com
// início 05/10 09:00 — o padrão do formulário (hoje 09:00), dez horas antes da criação — e nada
// perguntou. Ele queria 07/10 09:00. Compromisso que começa no passado não gera lembrete, não
// entra no bom dia e depois vira cobrança "como foi?" de algo que não aconteceu.
//
// Regra (gêmea de src/lib/evento-no-passado.js do TOM — mudam juntas): início mais de
// PAST_START_GRACE_MIN minutos antes de agora → o formulário para e pergunta, com "Criar mesmo
// assim" (mesmo padrão do banner de conflito). A folga existe pra "reunião que começou agora".
export const PAST_START_GRACE_MIN = 15;

export function isStartInPast(
  startIso: string | null | undefined,
  nowMs: number = Date.now(),
  graceMin: number = PAST_START_GRACE_MIN,
): boolean {
  if (!startIso) return false;
  const t = new Date(startIso).getTime();
  if (!Number.isFinite(t)) return false;
  return t < nowMs - graceMin * 60_000;
}

const FMT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** "05/10 09:00" no fuso de SP. */
export function pastStartLabel(startIso: string): string {
  const p = Object.fromEntries(FMT.formatToParts(new Date(startIso)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}
