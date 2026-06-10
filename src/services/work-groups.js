// src/services/work-groups.js — grupos de trabalho (pool de tarefas por grupo).
// Spec: docs/superpowers/specs/2026-06-10-grupos-de-trabalho-design.md
// supabase SEMPRE injetado; resolução por NOME é pura (testável) — id NUNCA vem do LLM.
'use strict';

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim();

function slugify(name) {
  return norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Carrega grupos ativos com membros (nome do colaborador junto, pro prompt).
async function loadActiveGroups(supabase) {
  const { data: groups } = await supabase
    .from('work_groups')
    .select('id, name, slug, leader_id, active')
    .eq('active', true)
    .order('name');
  if (!groups || !groups.length) return [];
  const ids = groups.map((g) => g.id);
  // FK explícita obrigatória: a tabela tem 2 FKs pra collaborators (collaborator_id e added_by).
  const { data: members } = await supabase
    .from('work_group_members')
    .select('group_id, collaborator_id, collaborator:collaborators!work_group_members_collaborator_id_fkey(full_name, phone, is_active)')
    .in('group_id', ids);
  return groups.map((g) => ({
    ...g,
    members: (members || [])
      .filter((m) => m.group_id === g.id && m.collaborator && m.collaborator.is_active !== false)
      .map((m) => ({
        collaborator_id: m.collaborator_id,
        full_name: m.collaborator.full_name,
        phone: m.collaborator.phone || null,
      })),
  }));
}

// PURA: resolve nome/slug contra a lista carregada. Exato (nome ou slug) vence;
// senão prefixo; ambíguo → {group:null, candidates}; ausente → {group:null, candidates:[]}.
function resolveGroupByName(groups, ref) {
  const q = norm(ref);
  if (!q) return { group: null, candidates: [] };
  const qSlug = slugify(ref);
  const exact = (groups || []).filter((g) => norm(g.name) === q || g.slug === qSlug);
  if (exact.length === 1) return { group: exact[0], candidates: [] };
  if (exact.length > 1) return { group: null, candidates: exact };
  const pre = (groups || []).filter((g) => norm(g.name).startsWith(q) || g.slug.startsWith(qSlug));
  if (pre.length === 1) return { group: pre[0], candidates: [] };
  return { group: null, candidates: pre };
}

function memberIdsOf(group) {
  return (group && group.members ? group.members : []).map((m) => m.collaborator_id);
}

function isMember(group, collaboratorId) {
  return memberIdsOf(group).includes(collaboratorId);
}

// Ids dos grupos de um colaborador (pra visibilidade em queries).
async function groupIdsOfCollaborator(supabase, collaboratorId) {
  const { data } = await supabase
    .from('work_group_members')
    .select('group_id')
    .eq('collaborator_id', collaboratorId);
  return (data || []).map((r) => r.group_id);
}

// Membros (ativos, com phone) de um grupo — pro fan-out de lembretes/avisos.
async function membersWithPhones(supabase, groupId) {
  const { data } = await supabase
    .from('work_group_members')
    .select('collaborator_id, collaborator:collaborators!work_group_members_collaborator_id_fkey(full_name, phone, is_active)')
    .eq('group_id', groupId);
  return (data || [])
    .filter((m) => m.collaborator && m.collaborator.is_active !== false && m.collaborator.phone)
    .map((m) => ({ collaborator_id: m.collaborator_id, full_name: m.collaborator.full_name, phone: m.collaborator.phone }));
}

module.exports = { slugify, loadActiveGroups, resolveGroupByName, memberIdsOf, isMember, groupIdsOfCollaborator, membersWithPhones };
