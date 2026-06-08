// src/services/governance-edges.js
// Carrega colaboradores ativos JÁ com explicit_leader_ids anexado a partir da
// tabela governance_edges (matriz de governança editável). Fonte única pro roteamento
// do TOM (substitui os SELECTs soltos de colaboradores no dispatcher).
'use strict';

const { groupLeaderIdsFor } = require('./leader-routing');

async function loadCollabsWithEdges(supabase) {
  const { data: collabs } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, function_role, unit, is_ceo, is_active, supervisor_id')
    .eq('is_active', true);
  const list = collabs || [];
  const { data: edges } = await supabase
    .from('governance_edges')
    .select('member_id, leader_id');
  const { data: groupLeaders } = await supabase
    .from('governance_leaders')
    .select('group_key, unit, leader_id');
  const byMember = new Map();
  for (const e of (edges || [])) {
    if (!byMember.has(e.member_id)) byMember.set(e.member_id, []);
    byMember.get(e.member_id).push(e.leader_id);
  }
  for (const c of list) {
    c.explicit_leader_ids = byMember.get(c.id) || [];
    c.group_leader_ids = groupLeaderIdsFor(c, groupLeaders || []);
  }
  return list;
}

module.exports = { loadCollabsWithEdges };
