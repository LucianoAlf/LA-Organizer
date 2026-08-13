// web/src/lib/recurrenceGuard.ts
// Guardrail anti-footgun (2026-07-02). O RecurrencePicker NUNCA gera UNTIL/COUNT,
// então TODA recorrência do app é sem-fim. FREQ=DAILY criou 30 cópias de "Ligar
// para aluno" no pool do ADM CG (a Vitória clicou "diária" sem querer numa tarefa
// pontual). Antes de criar, se a série inundar o horizonte curto E não tiver fim,
// o app pede confirmação — sem bloquear daily/semanal LEGÍTIMO (é só um "confirma?").
import { rrulestr } from 'rrule';
import { recurrenceLabel } from './groupWorkspace';

export const GUARD_HORIZON_DAYS = 30;
export const GUARD_SPAM_THRESHOLD = 10; // >=10 instâncias em 30d, sem fim = footgun

export interface RecurrenceWarning {
  count: number;   // ocorrências projetadas no horizonte
  cadence: string; // "diária" | "semanal" | "dias úteis" | …
}

/** Nº de ocorrências que o RRULE gera de startYmd até +horizon dias (inclusive). */
export function projectedInstances(
  rule: string | null | undefined,
  startYmd: string,
  horizonDays = GUARD_HORIZON_DAYS,
): number {
  if (!rule || !startYmd) return 0;
  try {
    const start = new Date(`${startYmd}T12:00:00Z`); // meio-dia UTC evita virada de DST
    if (isNaN(start.getTime())) return 0;
    const dtStr = start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const rule2 = rrulestr(`DTSTART:${dtStr}\nRRULE:${rule.replace(/^RRULE:/i, '')}`);
    const end = new Date(start.getTime() + horizonDays * 86400000);
    return rule2.between(start, end, true).length;
  } catch {
    return 0;
  }
}

/**
 * A linha é o MOLDE da série (a receita que gera as ocorrências), não uma ocorrência?
 *
 * Cancelar o molde mata a recorrência PARA SEMPRE, em silêncio: o materializador pula
 * molde cancelado, ninguém recebe erro, e as tarefas só param de nascer meses depois —
 * quando já não dá pra ligar uma coisa à outra. Foi o que aconteceu em 09/08/2026 com
 * quatro séries do Financeiro (Conciliação de Cartões + Repasses Maquininha nas 3 unidades).
 *
 * O chat do TOM protege isso desde 17/06 (pickInstanceTarget nunca mira molde). Este é o
 * irmão que faltava no app.
 *
 * Molde = tem regra E não é ocorrência de ninguém. A segunda metade importa: uma ocorrência
 * que ganhou regra própria continua sendo ocorrência, e a pessoa precisa poder cancelá-la.
 */
export function ehMoldeDeSerie(
  task: { recurrence_rule?: string | null; recurrence_parent_id?: string | null } | null | undefined,
): boolean {
  return !!(task && task.recurrence_rule && !task.recurrence_parent_id);
}

/** RRULE já tem fim explícito (UNTIL/COUNT)? Aí o usuário limitou de propósito. */
function hasEnd(rule: string): boolean {
  return /(?:^|;)\s*(?:UNTIL|COUNT)=/i.test(rule.replace(/^RRULE:/i, ''));
}

/** Retorna aviso se a recorrência é sem-fim e floda o horizonte; senão null. */
export function shouldWarnUnboundedRecurrence(
  rule: string | null | undefined,
  startYmd: string,
): RecurrenceWarning | null {
  if (!rule) return null;
  if (hasEnd(rule)) return null;
  const count = projectedInstances(rule, startYmd);
  if (count < GUARD_SPAM_THRESHOLD) return null;
  return { count, cadence: recurrenceLabel(rule) ?? 'recorrente' };
}
