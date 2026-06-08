// web/src/lib/team-routing.ts
// PORT de src/services/leader-routing.js — MESMA regra que o TOM usa pra cobrar
// (fonte única de "quem lidera quem"). Muitos-pra-muitos:
//   • pedagógico → AMBOS os coordenadores pedagógicos (Juliana + Quintela)
//   • marketing  → managers de marketing (Yuri)
//   • lotado numa unidade (barra/campo_grande/recreio) → gerente da unidade
//   • supervisor_id explícito → somado (aditivo, exceto se for o CEO)
//   • órfão / ele-mesmo líder → CEO
// Decisão do CEO (08/06, organograma): TODO pedagógico cai nos DOIS coordenadores —
// "tudo que a Quintela vê, a Juliana vê" (um lembra o outro). SEM exclusividade.
// Leo = pedagógico + Barra → Juliana + Quintela + Krissya.

export interface Collab {
  id: string;
  role: string;
  function_role: string | null;
  unit: string | null;
  supervisor_id: string | null;
  is_ceo: boolean;
  is_active?: boolean;
  explicit_leader_ids?: string[];
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
    // Grupo funcional → líderes (gerente/coord) do MESMO grupo. Generalizado p/ qualquer
    // grupo (pedagógico, comercial, marketing, financeiro, operações, sucesso_cliente…) sem
    // hardcode. Pedagógico cai nos 2 coords porque os dois têm function_role='pedagogico'.
    if (fr) for (const c of active) if ((c.role === 'coordinator' || c.role === 'manager') && c.function_role === fr) add(c);
  }
  // Override manual (matriz editável) — aditivo às regras. Pula CEO: ele já recebe
  // o digest completo (entra só pelo fallback de órfão, abaixo).
  for (const lid of (collab.explicit_leader_ids ?? [])) {
    const L = byId.get(lid);
    if (L && !L.is_ceo) add(L);
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
