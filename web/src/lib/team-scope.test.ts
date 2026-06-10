import { describe, it, expect } from 'vitest';
import { resolveScope } from './team-scope';
import { groupLeaderIdsFor, type Collab, type GroupLeader } from './team-routing';

const C = (p: Partial<Collab> & { id: string }): Collab => ({
  id: p.id, role: p.role ?? 'collaborator', function_role: p.function_role ?? null,
  unit: p.unit ?? null, supervisor_id: p.supervisor_id ?? null, is_ceo: p.is_ceo ?? false, is_active: p.is_active ?? true,
});

const ceo = C({ id: 'ceo', role: 'director', is_ceo: true });
const juliana = C({ id: 'ju', role: 'coordinator', function_role: 'pedagogico' });
const quintela = C({ id: 'qt', role: 'coordinator', function_role: 'pedagogico' });
const hugo = C({ id: 'hugo', role: 'director', function_role: 'tech' }); // líder sem liderados
const dai = C({ id: 'dai', function_role: 'pedagogico' });
const leo = C({ id: 'leo', function_role: 'pedagogico', unit: 'barra' });
const fabi = C({ id: 'fabi', function_role: 'farmer', unit: 'all' }); // colaborador comum
const all = [ceo, juliana, quintela, hugo, dai, leo, fabi];

// Matriz de governança (08/06): "pedagógico → ambos os coords" vem da tabela
// governance_leaders, anexada no load como group_leader_ids (governance-edges.ts);
// supervisor_id não é mais lido pelo roteamento.
const GROUP_LEADERS: GroupLeader[] = [
  { group_key: 'pedagogico', unit: 'all', leader_id: 'ju' },
  { group_key: 'pedagogico', unit: 'all', leader_id: 'qt' },
];
all.forEach(c => { c.group_leader_ids = groupLeaderIdsFor(c, GROUP_LEADERS); });

describe('resolveScope', () => {
  it('CEO → mode ceo, scopeIds null (vê tudo)', () => {
    const s = resolveScope('ceo', all);
    expect(s.mode).toBe('ceo');
    expect(s.scopeIds).toBeNull();
  });

  it('líder com time (Quintela) → todos os pedagógicos (Dai + Leo), os dois coords veem todos', () => {
    const s = resolveScope('qt', all);
    expect(s.mode).toBe('leader');
    expect(s.memberIds.sort()).toEqual(['dai', 'leo']);
    expect(s.scopeIds).toEqual(s.memberIds);
  });

  it('líder com time (Juliana) → também vê todos os pedagógicos (Dai + Leo)', () => {
    const s = resolveScope('ju', all);
    expect(s.mode).toBe('leader');
    expect(s.memberIds.sort()).toEqual(['dai', 'leo']);
  });

  it('líder sem liderados (Hugo) → mode none', () => {
    const s = resolveScope('hugo', all);
    expect(s.mode).toBe('none');
    expect(s.memberIds).toEqual([]);
  });

  it('colaborador comum (Fabi) → mode none (não lidera ninguém)', () => {
    expect(resolveScope('fabi', all).mode).toBe('none');
  });

  it('viewer inexistente → mode none', () => {
    expect(resolveScope('zzz', all).mode).toBe('none');
  });
});
