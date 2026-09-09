// web/src/lib/visibilidadeTarefas.ts
// AUTOR-CONTINUA-VENDO-O-POOL-DO-GRUPO-QUE-DEIXOU (Alf, 09/09/2026).
//
// A visibilidade de tarefa tem TRÊS pernas, repetidas em cinco arquivos:
//
//   assigned_to = eu   OU   created_by = eu   OU   assigned_group_id IN (meus grupos)
//
// A terceira já respeitava a saída do grupo (`useMyGroupIds` lê work_group_members). A segunda,
// não: "Arthur — anotar no campo Instagram" é do POOL do Administrativo e Comercial Barra
// (`assigned_to` nulo, `assigned_group_id` preenchido) e foi criada pelo Alf. Ele saiu do grupo,
// a terceira perna parou de trazer — e a segunda continuou, sozinha.
//
// A distinção que faltava: `created_by = eu` é uma rede de segurança para tarefa ÓRFÃ — criei,
// não atribuí a ninguém, então tem de aparecer para mim ou desaparece do mundo. Mas tarefa de
// pool NÃO é órfã: o dono dela é o GRUPO. Quem responde por ela são os membros, e quem saiu do
// grupo deixou de ser um deles.
//
// Então a rede do autor passa a valer só quando não há grupo dono:
//
//   assigned_to = eu
//   OU (created_by = eu E assigned_group_id É NULO)
//   OU assigned_group_id IN (meus grupos)
//
// Quem criou E é membro continua vendo pela terceira perna — nada muda para o caso normal.
// População medida antes de embarcar: no sistema inteiro, DUAS tarefas se encaixavam em
// "criei, é de pool, e não sou membro" — as duas do Alf (uma no Financeiro, uma na Barra).
//
// Fonte ÚNICA de propósito: as cinco portas (dayItems, taskGroups, Semana, useAgendaTasks,
// useNoPrazoTasks) montavam a mesma cláusula à mão. Guard duplicado é como a regra do lembrete
// que existia no snooze e faltava no reagendamento — a divergência aparece meses depois, num
// incidente.

/**
 * Cláusulas do `.or()` do PostgREST para "tarefas que eu posso ver".
 *
 * @param collabId  meu collaborator.id
 * @param groupIds  ids dos grupos em que sou MEMBRO (work_group_members)
 */
export function clausulasVisibilidade(collabId: string, groupIds: string[] = []): string[] {
  const vis = [
    `assigned_to.eq.${collabId}`,
    // A rede do autor tem DUAS ressalvas, cada uma paga com um incidente:
    //  1. `assigned_group_id.is.null` — tarefa de pool pertence ao GRUPO, não a quem criou.
    //  2. a cláusula `or(...)` de `source` — AUTORIA-TECNICA-NAO-E-DELEGACAO (Alf, 09/09):
    //     dezoito tarefas "Renovação em risco" nasceram de automação (`source: system`) com o
    //     id dele como autor, e o app as mostrava como se ele tivesse delegado pra Fabi e pra
    //     Jéssica. Ele nunca delegou nenhuma. `created_by` ali é quem a máquina usou como
    //     credencial, não quem decidiu. Tarefa de automação com dono OUTRO é da pessoa, ponto.
    //     Medido: saem 18, ficam as 35 delegações de verdade (todas `source: manual`).
    //     `source.is.null` entra porque `neq` não casa NULL em SQL — sem isso, tarefa antiga
    //     sem `source` desapareceria junto.
    `and(created_by.eq.${collabId},assigned_group_id.is.null,`
      + `or(assigned_to.is.null,assigned_to.eq.${collabId},source.is.null,source.neq.system))`,
  ];
  const ids = (Array.isArray(groupIds) ? groupIds : []).filter(Boolean);
  if (ids.length > 0) vis.push(`assigned_group_id.in.(${ids.join(',')})`);
  return vis;
}

/** A mesma regra em memória, para filtrar listas já carregadas. */
export function podeVerTarefa(
  t: { assigned_to?: string | null; created_by?: string | null; assigned_group_id?: string | null; source?: string | null } | null | undefined,
  collabId: string,
  groupIds: string[] = [],
): boolean {
  if (!t || !collabId) return false;
  if (t.assigned_to === collabId) return true;
  if (t.assigned_group_id) {
    return (Array.isArray(groupIds) ? groupIds : []).includes(t.assigned_group_id);
  }
  if (t.created_by !== collabId) return false;
  // Automação que usou meu id como credencial e entregou pra outra pessoa não é minha.
  if (t.source === 'system' && t.assigned_to) return false;
  return true;
}

/**
 * Isto é uma delegação MINHA — eu decidi passar pra outra pessoa?
 *
 * AUTORIA-TECNICA-NAO-E-DELEGACAO (Alf, 09/09/2026). A definição "created_by = eu E assigned_to
 * = outro" estava copiada em OITO lugares e nenhum olhava `source`. As dezesseis tarefas
 * "Renovação em risco" nasceram de automação (`source: system`) com o id dele como credencial:
 * apareciam na aba Delegadas dele como se ele tivesse repassado à Fabi e à Jéssica, e ele nunca
 * repassou nada. Ele reclamou TRÊS vezes até eu achar todas as cópias.
 *
 * Delegar é um ato de decisão. Automação que usou meu id não decidiu nada em meu nome.
 *
 * Rótulo de detalhe ("Delegada para X" em taskDetail.ts) fica fora daqui de propósito: ali a
 * pergunta é "quem é o dono?", e a resposta é a Fabi mesmo, tenha sido quem for que criou.
 */
export function ehDelegacaoMinha(
  t: { assigned_to?: string | null; created_by?: string | null; source?: string | null } | null | undefined,
  meuId: string | null | undefined,
): boolean {
  if (!t || !meuId) return false;
  if (t.created_by !== meuId) return false;
  if (!t.assigned_to || t.assigned_to === meuId) return false;
  return t.source !== 'system';
}

/** Condição de `.or()` que exclui automação — para as queries que filtram no servidor. */
export const NAO_E_AUTOMACAO = 'source.is.null,source.neq.system';
