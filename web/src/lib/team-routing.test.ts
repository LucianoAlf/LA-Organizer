import { describe, it, expect } from 'vitest';
import { resolveLeaderIdsOf, membersOf, type Collab } from './team-routing';

const C = (p: Partial<Collab> & { id: string }): Collab => ({
  id: p.id, role: p.role ?? 'collaborator', function_role: p.function_role ?? null,
  unit: p.unit ?? null, supervisor_id: p.supervisor_id ?? null, is_ceo: p.is_ceo ?? false, is_active: p.is_active ?? true,
});
const ceo = C({ id: 'ceo', role: 'director', is_ceo: true });
const juliana = C({ id: 'ju', role: 'coordinator', function_role: 'pedagogico' });
const quintela = C({ id: 'qt', role: 'coordinator', function_role: 'pedagogico' });
const krissya = C({ id: 'kr', role: 'manager', unit: 'barra' });
const yuri = C({ id: 'yu', role: 'manager', function_role: 'marketing', unit: 'all' });
const dai = C({ id: 'dai', function_role: 'pedagogico', supervisor_id: 'ju' });      // exclusivo Juliana
const matheus = C({ id: 'mat', function_role: 'pedagogico', supervisor_id: 'qt' }); // exclusivo Quintela
const jordan = C({ id: 'jordan', function_role: 'pedagogico', supervisor_id: 'ceo' }); // guarda-chuva
const leo = C({ id: 'leo', function_role: 'pedagogico', unit: 'barra', supervisor_id: 'kr' });
const john = C({ id: 'john', function_role: 'marketing', unit: 'all' });
const fabi = C({ id: 'fabi', function_role: 'farmer', unit: 'all' });
const all = [ceo, juliana, quintela, krissya, yuri, dai, matheus, jordan, leo, john, fabi];

describe('resolveLeaderIdsOf', () => {
  it('pedagógico cai nos DOIS coordenadores — Dai (mesmo com supervisor=Juliana)', () => {
    expect(resolveLeaderIdsOf(dai, all).sort()).toEqual(['ju', 'qt']);
  });
  it('pedagógico cai nos DOIS coordenadores — Matheus (mesmo com supervisor=Quintela)', () => {
    expect(resolveLeaderIdsOf(matheus, all).sort()).toEqual(['ju', 'qt']);
  });
  it('pedagógico (supervisor=CEO) também → AMBAS', () => {
    expect(resolveLeaderIdsOf(jordan, all).sort()).toEqual(['ju', 'qt']);
  });
  it('Leo (pedagógico + Barra) = Krissya + Juliana + Quintela', () => {
    expect(new Set(resolveLeaderIdsOf(leo, all))).toEqual(new Set(['kr', 'ju', 'qt']));
  });
  it('marketing → Yuri', () => {
    expect(resolveLeaderIdsOf(john, all)).toEqual(['yu']);
  });
  it('órfão (farmer unit=all, sem supervisor) → CEO', () => {
    expect(resolveLeaderIdsOf(fabi, all)).toEqual(['ceo']);
  });
  it('líder não é liderado de um par → fallback CEO', () => {
    expect(resolveLeaderIdsOf(juliana, all)).toEqual(['ceo']);
  });
});

describe('membersOf (inversa)', () => {
  it('os DOIS coordenadores veem todos os pedagógicos (Dai, Matheus, Jordan, Leo)', () => {
    const qt = membersOf(quintela, all).map(c => c.id).sort();
    const ju = membersOf(juliana, all).map(c => c.id).sort();
    for (const id of ['dai', 'mat', 'jordan', 'leo']) {
      expect(qt).toContain(id); expect(ju).toContain(id);
    }
  });
  it('time do CEO inclui os órfãos (Fabi)', () => {
    expect(membersOf(ceo, all).map(c => c.id)).toContain('fabi');
  });
});
