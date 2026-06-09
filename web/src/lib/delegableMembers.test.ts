import { describe, it, expect } from 'vitest';
import { delegableMembers } from './delegableMembers';
import type { Collab } from './team-routing';

const mk = (id: string, role: string, extra: Partial<Collab> = {}): Collab => ({
  id, role, function_role: null, unit: null, supervisor_id: null,
  is_ceo: false, is_active: true, explicit_leader_ids: [], group_leader_ids: [], ...extra,
});

describe('delegableMembers', () => {
  const dir = mk('dir', 'director', { is_ceo: true });
  const coord = mk('coord', 'coordinator');
  const m1 = mk('m1', 'collaborator', { explicit_leader_ids: ['coord'] });
  const m2 = mk('m2', 'collaborator', { explicit_leader_ids: ['coord'] });
  const other = mk('other', 'collaborator', { explicit_leader_ids: ['dir'] });
  const all = [dir, coord, m1, m2, other];

  it('coordenador vê só sua equipe direta (m1, m2) — exclui ele mesmo', () => {
    const ids = delegableMembers('coord', 'coordinator', all).map(c => c.id).sort();
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('diretor vê todos os ativos menos ele mesmo', () => {
    const ids = delegableMembers('dir', 'director', all).map(c => c.id).sort();
    expect(ids).toEqual(['coord', 'm1', 'm2', 'other']);
  });

  it('líder sem equipe configurada cai no fallback = todos ativos menos ele', () => {
    const lone = mk('lone', 'coordinator');
    const ids = delegableMembers('lone', 'coordinator', [lone, m1, m2]).map(c => c.id).sort();
    expect(ids).toEqual(['m1', 'm2']);
  });

  it('exclui colaboradores inativos', () => {
    const inactive = mk('inact', 'collaborator', { explicit_leader_ids: ['coord'], is_active: false });
    const ids = delegableMembers('coord', 'coordinator', [...all, inactive]).map(c => c.id);
    expect(ids).not.toContain('inact');
  });
});
