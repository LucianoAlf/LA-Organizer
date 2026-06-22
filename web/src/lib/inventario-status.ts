// Fonte de verdade ÚNICA do filtro de status do inventário.
// Consumido pelo contador (useInventarioStats) E pela lista (useInventarioItensPorStatus),
// garantindo que a lista do drill-down SEMPRE bata com o número do card.

export type InventarioStatusTipo = 'atencao' | 'manutencao';

/**
 * Data-limite da janela de "atenção": hoje + 30 dias, em YYYY-MM-DD.
 * Mantém EXATAMENTE a fórmula do contador original (epoch + 30d → toISOString),
 * de propósito, p/ paridade com o card. NÃO trocar por YMD local aqui: mudaria o
 * número do card por timezone (só `ativo=true` foi aprovado como mudança). `now` injetável p/ teste.
 */
export function proximaRevisaoLimite(now?: Date): string {
  const base = now ? now.getTime() : Date.now();
  return new Date(base + 30 * 86400000).toISOString().slice(0, 10);
}

/**
 * Aplica o filtro do status numa query do laReportClient (builder fluente do supabase-js).
 * SEMPRE inclui .eq('ativo', true). Depois, por tipo:
 *   atencao    → .lte('proxima_revisao', limite)
 *   manutencao → .eq('status', 'manutencao')
 * Retorna a própria query (encadeável). Usado por count(head) E por select(*).
 */
export function aplicaFiltroStatus<Q extends {
  eq: (col: string, val: unknown) => Q;
  lte: (col: string, val: unknown) => Q;
}>(query: Q, tipo: InventarioStatusTipo, now?: Date): Q {
  let q = query.eq('ativo', true);
  if (tipo === 'atencao') q = q.lte('proxima_revisao', proximaRevisaoLimite(now));
  else q = q.eq('status', 'manutencao');
  return q;
}

/** YMD LOCAL (sem deslocamento UTC) do Date informado. */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Diferença em dias inteiros entre dois YYYY-MM-DD (a - b), sem efeito de fuso. */
function diasEntre(aYmd: string, bYmd: string): number {
  const [ay, am, ad] = aYmd.split('-').map(Number);
  const [by, bm, bd] = bYmd.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/**
 * Label humana da revisão para o card de ATENÇÃO. Função pura.
 *   passado → { texto: 'Revisão venceu há Nd', tom: 'danger' }
 *   hoje    → { texto: 'Revisão vence hoje', tom: 'danger' }
 *   futuro  → { texto: 'Revisão em Nd', tom: 'warning' }
 *   null    → null
 */
export function statusRevisao(
  proxima_revisao: string | null,
  now?: Date,
): { texto: string; tom: 'danger' | 'warning' } | null {
  if (!proxima_revisao) return null;
  const hoje = ymdLocal(now ?? new Date());
  const diff = diasEntre(proxima_revisao.slice(0, 10), hoje);
  if (diff < 0) return { texto: `Revisão venceu há ${-diff}d`, tom: 'danger' };
  if (diff === 0) return { texto: 'Revisão vence hoje', tom: 'danger' };
  return { texto: `Revisão em ${diff}d`, tom: 'warning' };
}
