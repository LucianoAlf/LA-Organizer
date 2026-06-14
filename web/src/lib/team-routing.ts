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
  group_leader_ids?: string[];
}

/** Linha da tabela governance_leaders: quem lidera <group_key> em <unit> ('all'=global). */
export interface GroupLeader { group_key: string; unit: string; leader_id: string; }

/**
 * Líderes do grupo de um colaborador: casa o function_role (grupo) dele contra a tabela,
 * com unit 'all' (global) OU a unidade da pessoa (farmer por-loja). Função PURA.
 */
export function groupLeaderIdsFor(collab: Collab, groupLeaders: GroupLeader[]): string[] {
  const fr = collab?.function_role || null;
  if (!fr) return [];
  const unit = collab.unit || null;
  return (groupLeaders ?? [])
    .filter(g => g.group_key === fr && (g.unit === 'all' || g.unit === unit))
    .map(g => g.leader_id);
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
  const unit = collab.unit || null;
  const isSelfLeader = LEADER_ROLES.has(collab.role);
  if (!isSelfLeader) {
    if (unit && UNITS.has(unit)) for (const c of active) if (c.role === 'manager' && c.unit === unit) add(c);
    // Líderes do grupo vêm da tabela governance_leaders (group+unit), anexados no load como
    // group_leader_ids via groupLeaderIdsFor. Desacoplado do nível de acesso (uma farmer
    // pode liderar farmers da unidade dela sem ser gerente).
    for (const lid of (collab.group_leader_ids ?? [])) { const L = byId.get(lid); if (L) add(L); }
  }
  // Override manual (matriz editável) — aditivo às regras. O CEO PODE entrar como líder
  // explícito (opt-in do Diretor: "Ana reporta a mim e à Rose"). As regras AUTOMÁTICAS
  // nunca adicionam o CEO; o ENVIO do digest por-líder também o pula (ele tem o report completo).
  for (const lid of (collab.explicit_leader_ids ?? [])) {
    const L = byId.get(lid);
    if (L) add(L);
  }
  if (leaders.size === 0) for (const c of active) if (c.is_ceo) add(c);
  return [...leaders.values()];
}

export function resolveLeaderIdsOf(collab: Collab, allCollabs: Collab[]): string[] {
  return resolveLeadersOf(collab, allCollabs).map(c => c.id);
}

/** Espelho de src/services/leader-routing.js governanceViewerIdsOf — manter idêntico.
 * DELEGADA (governance_owner_id) → só o delegador. SOLTA (NULL) → os líderes do DONO pela
 * MESMA regra de evento/time (resolveLeaderIdsOf): unidade REAL→gerente + group_leaders +
 * arestas + CEO. NÃO tratar o sentinel unit='all' como unidade real (vazamento 14/06: Yuri
 * unit='all' herdava a atrasada de todo unit='all'). Vazio → caller cai no CEO.
 */
export function governanceViewerIdsOf(
  task: { governance_owner_id?: string | null; assigned_to: string },
  owner: Collab | undefined,
  allCollabs: Collab[],
): string[] {
  if (task && task.governance_owner_id) return [task.governance_owner_id];
  if (!owner) return [];
  return resolveLeaderIdsOf(owner, allCollabs);
}

/** Inversa: todos os colaboradores ativos cujo conjunto de líderes inclui `leader`. */
export function membersOf(leader: Collab, allCollabs: Collab[]): Collab[] {
  return (allCollabs ?? [])
    .filter(c => c && c.is_active !== false && c.id !== leader.id)
    .filter(c => resolveLeaderIdsOf(c, allCollabs).includes(leader.id));
}
