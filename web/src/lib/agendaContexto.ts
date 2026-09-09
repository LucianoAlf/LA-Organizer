// web/src/lib/agendaContexto.ts
// DELEGADA-CONTA-COMO-MINHA (Alf, 09/09/2026).
//
// A agenda do dono do produto tinha 20 tarefas em setembro. TRÊS eram dele. As outras 17 eram
// da Fabi e da Jéssica — ele só as criou. Das 11 "atrasadas" que o app cobrava dele, DEZ eram
// atraso de outra pessoa. Ele olhou a tela e disse que nem ele estava conseguindo usar o app.
//
// A causa é uma regra que parece certa e não é: a aba Trabalho filtrava por `context === 'work'`
// e mais nada. Tarefa delegada continua sendo `context: 'work'` — então entrava junto, na lista
// e nos contadores. O mesmo em `contextCounts`. E as views da direita (a grade do calendário)
// recebiam o array CRU, sem filtro de contexto nenhum, por isso os chips apareciam no mês.
//
// A pílula "Delegadas" já existia e já sabia se separar (`delegated_to` é derivado em
// useAgendaTasks: created_by = eu E assigned_to = outra pessoa). O que faltava era o outro lado:
// se ela tem lugar próprio, não deveria estar também na aba de quem delegou.
//
// A REGRA, decidida pelo Alf em 09/09: o que eu delego aparece SÓ na aba Delegadas.
// "Atrasada" na minha tela volta a significar que EU estou devendo.
//
// Precedência importa: delegada é avaliada ANTES do contexto — é o mesmo desempate que o filtro
// de fonte (`useAgendaTasks`) já usa, e mantê-los iguais é o que impede as duas camadas de
// divergirem depois.

export type AgendaContext = 'work' | 'personal' | 'delegated';

export interface TarefaParaContexto {
  context?: string | null;
  delegated_to?: string | null;
}

/** Esta tarefa pertence à aba `ctx`? */
export function pertenceAoContexto(t: TarefaParaContexto | null | undefined, ctx: AgendaContext): boolean {
  if (!t) return false;
  const delegada = t.delegated_to != null && t.delegated_to !== '';
  if (ctx === 'delegated') return delegada;
  // Delegada tem casa própria: não polui a agenda de quem delegou.
  if (delegada) return false;
  return t.context === ctx;
}

/** Filtro de lista pela mesma regra (ordem preservada). */
export function doContexto<T extends TarefaParaContexto>(tarefas: T[] | null | undefined, ctx: AgendaContext): T[] {
  return (Array.isArray(tarefas) ? tarefas : []).filter((t) => pertenceAoContexto(t, ctx));
}
