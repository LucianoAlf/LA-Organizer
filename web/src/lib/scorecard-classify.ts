// web/src/lib/scorecard-classify.ts
// PORT de src/rituals/leader-cards.js → classifyCard — MESMA régua do digest do TOM.
// Escopo = líder + time (§3.3); % é SEMANAL, contagem é AO VIVO (§7.1).
//   🔴 Atenção: closure < 0.60 OU 3+ atrasadas OU 2+ travadas (precisa ter tarefas)
//   🟡 Olhar:   closure < 0.85 OU 1+ atrasadas (precisa ter tarefas)
//   🟢 Ritmo:   todos os demais (incluindo sem tarefas registradas)

export interface ScoreLite {
  closure_rate: number | null;   // null = SEM NOTA (§7.3). Nunca 1.0 por falta de denominador.
  tasks_closed: number;
  tasks_overdue: number;
  tasks_stuck: number;
}

export type ScoreBucket = 'atencao' | 'olhar' | 'ritmo';

export function classifyScorecard(sc: ScoreLite): ScoreBucket {
  const hasNoTasks = sc.tasks_closed === 0 && sc.tasks_overdue === 0 && sc.tasks_stuck === 0;
  // Guard de null OBRIGATÓRIO: `null < 0.60` é `true` em JS (null coage pra 0) — sem ele
  // todo líder sem nota viraria 'atencao'.
  const badPct = sc.closure_rate !== null && sc.closure_rate < 0.60;
  const midPct = sc.closure_rate !== null && sc.closure_rate < 0.85;
  if (!hasNoTasks && (badPct || sc.tasks_overdue >= 3 || sc.tasks_stuck >= 2)) return 'atencao';
  if (!hasNoTasks && (midPct || sc.tasks_overdue >= 1)) return 'olhar';
  return 'ritmo';
}

// Sem nota não imprime 0% — não imprime nada.
export function pctOf(rate: number | null): number | null {
  return rate === null ? null : Math.round(rate * 100);
}

// Shape mínimo pro sort — `LeaderScorecard` (useLeaderScorecards.ts) satisfaz
// estruturalmente. `leader` é nullable de verdade aqui: o join `collaborators!leader_id`
// pode não casar, coisa que o lado Node (leadersById.get + `if (!leader) continue`) nunca vê.
export interface ScoreSortable {
  closure_rate: number | null;
  leader_id: string;
  leader: { full_name: string; preferred_name: string | null } | null;
}

// `ScoreSortable` + o termo que o balde `ritmo` ordena. Separado porque `byRateNoScoreLast`
// não precisa de `tasks_closed` — e um tipo só forçaria fixtures a carregar campo morto.
export interface ScoreSortableClosed extends ScoreSortable {
  tasks_closed: number;
}

// Desempate DETERMINÍSTICO — espelha byNameThenId do lado Node: full_name (não
// preferred_name, que é só exibição) + id. `leader_id` no lugar de `leader.id` porque é a
// MESMA coluna e sobrevive ao join vazio.
// PÚBLICO de propósito: é o tiebreak COMPARTILHADO pelos dois comparadores abaixo. Um
// segundo tiebreak escrito à mão no consumidor divergiria deste — não faça, reuse.
export const byNameThenId = (a: ScoreSortable, b: ScoreSortable): number =>
  (a.leader?.full_name ?? '').localeCompare(b.leader?.full_name ?? '', 'pt-BR') ||
  a.leader_id.localeCompare(b.leader_id);

// PORT de src/services/scorecard-render.js → byRateNoScoreLast (linhas 46-53). Os dois
// mudam juntos. Pior nota primeiro, SEM NOTA por último — explicitamente.
//   `(a.closure_rate ?? 0) - (b.closure_rate ?? 0)` coagia null pra 0 e EMPATAVA "sem nota"
//   com "0% real", que são OPOSTOS: 0% é o pior desempenho possível (fechou 0 de 3); sem
//   nota é ausência do que medir (denominador 0).
//   ⚠️ Infinity como sentinela resolveria o lado errado e ainda daria `Infinity - Infinity
//   = NaN` entre dois sem-nota — comparator inválido, ordem indefinida.
//   ⚠️ O tiebreak fecha o bloco de empates que este próprio fix CRIA (todos os sem-nota
//   passam a empatar entre si): `.sort()` é estável e só PRESERVA a ordem de entrada, que
//   aqui é a do heap do Postgres (o loader não tem ORDER BY em query nenhuma) — sem ele o
//   fix de ordem vira bug de ordem, reembaralhando sozinho na cara do CEO.
// Guard é `=== null` e não `== null`/`??`: o tipo já exclui `undefined` (o lado Node checa
// os dois porque JS não tem tipo), e `0` é nota REAL que tem que passar.
export function byRateNoScoreLast(a: ScoreSortable, b: ScoreSortable): number {
  const ra = a.closure_rate;
  const rb = b.closure_rate;
  if (ra === null || rb === null) {
    if (ra !== rb) return ra === null ? 1 : -1;   // só um é sem-nota → ele vai por último
    return byNameThenId(a, b);                    // ambos sem nota → empate real
  }
  if (ra !== rb) return ra - rb;                  // ambos com nota: pior primeiro
  return byNameThenId(a, b);                      // mesma nota → empate real
}

// PORT de src/services/scorecard-render.js:91 — o sort do balde `ritmo`. Os dois mudam
// juntos. Mais fechadas primeiro; o tiebreak fecha o empate, que aqui é o caso COMUM
// (vários líderes estáveis com o mesmo tasks_closed). Sem ele o bloco 🟢 — que imprime os
// nomes em LINHA colapsada — reembaralhava sozinho na cara do CEO sem nenhum dado ter
// mudado: `.sort()` é estável e só PRESERVA a ordem de entrada, que é a do heap do
// Postgres (o loader não tem ORDER BY). Mesma doença da #9 (Tasks 1 e 2).
export function byClosedThenName(a: ScoreSortableClosed, b: ScoreSortableClosed): number {
  return (b.tasks_closed - a.tasks_closed) || byNameThenId(a, b);
}

export const BUCKET_META: Record<ScoreBucket, { dot: string; label: string }> = {
  atencao: { dot: '#ef5b5b', label: 'Atenção' },
  olhar: { dot: '#f5a623', label: 'Olhar de perto' },
  ritmo: { dot: '#3ECF8E', label: 'No ritmo' },
};
