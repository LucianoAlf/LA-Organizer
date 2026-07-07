// web/src/lib/workGroupAccess.ts
// Regra ÚNICA de visibilidade de grupos de trabalho (Alf 06/07, v2 — caso Rose):
// só o DIRETOR enxerga todos os grupos. Qualquer outro papel (coordinator e manager
// INCLUSOS) vê apenas os grupos em que é MEMBRO, LÍDER ou CRIADOR. Vale pra toda
// porta: lista, workspace por link, anotações, config e o picker do QuickCreate.
// Antes cada tela repetia `director||coordinator||manager||líder` — e manager via tudo.

export interface GroupForAccess {
  id: string;
  leader_id: string | null;
  created_by?: string | null;
}

export interface AccessCtx {
  role: string | null | undefined;      // papel do usuário logado
  meuId: string | null | undefined;     // collaborator.id
  myGroupIds: ReadonlySet<string>;      // grupos onde sou membro (work_group_members)
}

export function isGroupAdmin(role: string | null | undefined): boolean {
  return role === 'director';
}

/** Posso VER este grupo? admin OU membro OU líder OU criador. */
export function canSeeGroup(g: GroupForAccess, ctx: AccessCtx): boolean {
  if (isGroupAdmin(ctx.role)) return true;
  if (!ctx.meuId) return false;
  return ctx.myGroupIds.has(g.id) || g.leader_id === ctx.meuId || g.created_by === ctx.meuId;
}

/** Lista filtrada pela mesma regra (ordem preservada). */
export function visibleWorkGroups<T extends GroupForAccess>(groups: T[], ctx: AccessCtx): T[] {
  if (isGroupAdmin(ctx.role)) return groups;
  return groups.filter(g => canSeeGroup(g, ctx));
}

/** Posso CONFIGURAR (engrenagem: membros, nome, desativar)? admin OU líder OU criador.
 *  Membro comum vê mas não configura; coordinator/manager sem vínculo nem veem. */
export function canConfigureGroup(g: GroupForAccess, ctx: AccessCtx): boolean {
  if (isGroupAdmin(ctx.role)) return true;
  if (!ctx.meuId) return false;
  return g.leader_id === ctx.meuId || g.created_by === ctx.meuId;
}
