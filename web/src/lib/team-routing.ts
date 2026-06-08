// web/src/lib/team-routing.ts
// PORT de src/services/leader-routing.js — MESMA regra que o TOM usa pra cobrar
// (fonte única de "quem lidera quem"). Muitos-pra-muitos:
//   • pedagógico EXCLUSIVO (supervisor já é coord. pedag.) → só ela (Dai→Juliana, Matheus→Quintela)
//   • pedagógico guarda-chuva (supervisor não-coord.) → AMBAS as coordenadoras (Juliana + Quintela)
//   • marketing  → managers de marketing (Yuri)
//   • lotado numa unidade (barra/campo_grande/recreio) → gerente da unidade
//   • supervisor_id explícito → somado (aditivo, exceto se for o CEO)
//   • órfão / ele-mesmo líder → CEO
// Decisão do CEO (08/06, organograma): Dai=só Juliana; Matheus=só Quintela;
// Jordan/Peterson/Ramon/Rodrigo/Leo=nos dois; Leo=+Krissya (Barra operacional).

export interface Collab {
  id: string;
  role: string;
  function_role: string | null;
  unit: string | null;
  supervisor_id: string | null;
  is_ceo: boolean;
  is_active?: boolean;
}

const UNITS = new Set(['barra', 'campo_grande', 'recreio']);
const LEADER_ROLES = new Set(['manager', 'coordinator', 'director']);

export function resolveLeadersOf(collab: Collab, allCollabs: Collab[]): Collab[] {
  if (!collab) return [];
  const list = Array.isArray(allCollabs) ? allCollabs : [];
  const byId = new Map(list.map(c => [c.id, c]));
  const active = list.filter(c => c && c.is_active !== false);
  const leaders = new Map<string, Collab>();
  const add = (c?: Collab) => {
    if (!c || c.id === collab.id || c.is_active === false) return;
    if (!leaders.has(c.id)) leaders.set(c.id, c);
  };
  const fr = collab.function_role || null;
  const unit = collab.unit || null;
  const isSelfLeader = LEADER_ROLES.has(collab.role);
  if (!isSelfLeader) {
    if (unit && UNITS.has(unit)) for (const c of active) if (c.role === 'manager' && c.unit === unit) add(c);
    if (fr === 'pedagogico') {
      // Exclusividade (organograma): supervisor já é coord. pedagógica
      // (Dai→Juliana, Matheus→Quintela) → fica EXCLUSIVO a ela (entra pelo
      // passo do supervisor abaixo). Senão → guarda-chuva: AS DUAS coordenadoras.
      const sup = collab.supervisor_id ? byId.get(collab.supervisor_id) : undefined;
      const supIsPedCoord = !!sup && sup.role === 'coordinator' && sup.function_role === 'pedagogico';
      if (!supIsPedCoord) for (const c of active) if (c.role === 'coordinator' && c.function_role === 'pedagogico') add(c);
    }
    if (fr === 'marketing') for (const c of active) if (c.role === 'manager' && c.function_role === 'marketing') add(c);
  }
  if (collab.supervisor_id && byId.has(collab.supervisor_id)) {
    const sup = byId.get(collab.supervisor_id);
    if (sup && !sup.is_ceo) add(sup);
  }
  if (leaders.size === 0) for (const c of active) if (c.is_ceo) add(c);
  return [...leaders.values()];
}

export function resolveLeaderIdsOf(collab: Collab, allCollabs: Collab[]): string[] {
  return resolveLeadersOf(collab, allCollabs).map(c => c.id);
}

/** Inversa: todos os colaboradores ativos cujo conjunto de líderes inclui `leader`. */
export function membersOf(leader: Collab, allCollabs: Collab[]): Collab[] {
  return (allCollabs ?? [])
    .filter(c => c && c.is_active !== false && c.id !== leader.id)
    .filter(c => resolveLeaderIdsOf(c, allCollabs).includes(leader.id));
}
