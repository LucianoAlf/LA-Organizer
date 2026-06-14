import { describe, it, expect } from 'vitest';
import { resolveLeaderIdsOf, membersOf, groupLeaderIdsFor, governanceViewerIdsOf, type Collab } from './team-routing';

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
// Líderes de grupo (governance_leaders) — anexa group_leader_ids como o loader real faz.
const GROUP_LEADERS = [
  { group_key: 'pedagogico', unit: 'all', leader_id: 'ju' },
  { group_key: 'pedagogico', unit: 'all', leader_id: 'qt' },
  { group_key: 'marketing',  unit: 'all', leader_id: 'yu' },
];
all.forEach(c => { c.group_leader_ids = groupLeaderIdsFor(c, GROUP_LEADERS); });

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
  it('grupo via tabela: comercial (global) cai no líder comercial', () => {
    const GL = [{ group_key: 'comercial', unit: 'all', leader_id: 'cm' }];
    const cmgr = C({ id: 'cm', role: 'manager', function_role: 'comercial' });
    const ccol = C({ id: 'cc', function_role: 'comercial' });
    ccol.group_leader_ids = groupLeaderIdsFor(ccol, GL);
    expect(resolveLeaderIdsOf(ccol, [ceo, cmgr, ccol])).toEqual(['cm']);
  });
  it('groupLeaderIdsFor: farmer por unidade casa só a unidade; global casa todas', () => {
    const GL = [
      { group_key: 'farmer', unit: 'campo_grande', leader_id: 'gabi' },
      { group_key: 'comercial', unit: 'all', leader_id: 'kr' },
    ];
    expect(groupLeaderIdsFor(C({ id: 'x', function_role: 'farmer', unit: 'campo_grande' }), GL)).toEqual(['gabi']);
    expect(groupLeaderIdsFor(C({ id: 'y', function_role: 'farmer', unit: 'barra' }), GL)).toEqual([]);
    expect(groupLeaderIdsFor(C({ id: 'z', function_role: 'comercial', unit: 'barra' }), GL)).toEqual(['kr']);
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

describe('explicit_leader_ids (override manual N:N)', () => {
  const rafinha = C({ id: 'raf', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all' });
  const dudu = C({ id: 'dudu', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all' });
  dudu.explicit_leader_ids = ['raf'];
  const base = [ceo, juliana, quintela, krissya, rafinha, dudu];

  it('aresta explícita define o líder (Dudu → Rafinha, não cai no CEO)', () => {
    expect(resolveLeaderIdsOf(dudu, base)).toEqual(['raf']);
  });
  it('membersOf enxerga a aresta (Rafinha tem Dudu)', () => {
    expect(membersOf(rafinha, base).map(c => c.id)).toContain('dudu');
  });
  it('aresta soma às regras e deduplica (pedagógico + aresta p/ Juliana = ju+qt)', () => {
    const daiX = C({ id: 'daiX', function_role: 'pedagogico' });
    daiX.explicit_leader_ids = ['ju'];
    daiX.group_leader_ids = groupLeaderIdsFor(daiX, GROUP_LEADERS);
    const arr = [ceo, juliana, quintela, daiX];
    expect(resolveLeaderIdsOf(daiX, arr).sort()).toEqual(['ju', 'qt']);
  });
  it('aresta explícita ao CEO é HONRADA (N:N opt-in: reporta ao CEO + outro líder = ambos)', () => {
    const x = C({ id: 'x' });
    x.explicit_leader_ids = ['ju', 'ceo'];
    expect(resolveLeaderIdsOf(x, [ceo, juliana, x])).toEqual(['ju', 'ceo']);
  });
});

// ── governanceViewerIdsOf (espelho de leader-routing.js) ────────────────────
describe('governanceViewerIdsOf', () => {
  const govJereh: Collab = { id: 'jereh', role: 'manager', function_role: null, unit: 'campo_grande', supervisor_id: null, is_ceo: false, is_active: true };
  const govRose:  Collab = { id: 'rose',  role: 'manager', function_role: null, unit: 'all',          supervisor_id: null, is_ceo: false, is_active: true };
  const govKris:  Collab = { id: 'kris',  role: 'manager', function_role: null, unit: 'all',          supervisor_id: null, is_ceo: false, is_active: true };
  const govGabi:  Collab = { id: 'gabi',  role: 'collaborator', function_role: null, unit: 'campo_grande', supervisor_id: null, is_ceo: false, explicit_leader_ids: [] };
  const govVit:   Collab = { id: 'vit',   role: 'collaborator', function_role: null, unit: 'campo_grande', supervisor_id: null, is_ceo: false, explicit_leader_ids: [] };
  const allGov = [govJereh, govRose, govKris, govGabi, govVit];

  it('Rose delegou → só a Rose vê (Jereh não)', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: 'rose', assigned_to: 'gabi' }, govGabi, allGov)).toEqual(['rose']);
  });
  it('Jereh delegou tarefa → Jereh vê (tema ignorado)', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: 'jereh', assigned_to: 'gabi' }, govGabi, allGov)).toEqual(['jereh']);
  });
  it('tarefa solta da Gabi (NULL, unit campo_grande) → gerente da unidade (Jereh)', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'gabi' }, govGabi, allGov)).toEqual(['jereh']);
  });
  it('tarefa solta da Vitória (NULL) → Jereh, NÃO Krissya', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'vit' }, govVit, allGov)).toEqual(['jereh']);
  });
  it('Krissya delegou → Krissya', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: 'kris', assigned_to: 'vit' }, govVit, allGov)).toEqual(['kris']);
  });
  it('solta sem unidade → vazio (caller cai no CEO)', () => {
    const semUnit: Collab = { id: 'x', role: 'collaborator', function_role: null, unit: null, supervisor_id: null, is_ceo: false, explicit_leader_ids: [] };
    expect(governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'x' }, semUnit, [...allGov, semUnit])).toEqual([]);
  });
  it('manager inativo na unidade é excluído (joff não aparece)', () => {
    const jerehOff: Collab = { id: 'joff', role: 'manager', function_role: null, unit: 'campo_grande', supervisor_id: null, is_ceo: false, is_active: false };
    const collab = [...allGov, jerehOff];
    expect(governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'gabi' }, govGabi, collab)).toEqual(['jereh']);
  });
  it('owner undefined (pessoa deletada) → []', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'ghost' }, undefined, allGov)).toEqual([]);
  });
});

// ── REGRESSÃO 14/06: unit='all' não é unidade real (espelho do fix backend) ──
// Tarefa solta segue a MESMA regra de líder (resolveLeaderIdsOf): nada de tratar o
// sentinel 'all' como unidade física e casar todo manager unit='all' (Yuri vazava).
describe('governanceViewerIdsOf — unit=all não vaza', () => {
  it('solta de Fabi (farmer, unit=all, órfã) → CEO, NÃO Yuri', () => {
    const v = governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'fabi' }, fabi, all);
    expect(v).toEqual(['ceo']);
    expect(v).not.toContain('yu');
  });
  it('solta de John (marketing, unit=all) → Yuri', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'john' }, john, all)).toEqual(['yu']);
  });
  it('solta de Dai (pedagógico) → coordenadores, nunca Yuri', () => {
    const v = governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'dai' }, dai, all).sort();
    expect(v).toEqual(['ju', 'qt']);
    expect(v).not.toContain('yu');
  });
  it('delegação curto-circuita (governance_owner_id manda mesmo com unit=all)', () => {
    expect(governanceViewerIdsOf({ governance_owner_id: 'yu', assigned_to: 'fabi' }, fabi, all)).toEqual(['yu']);
  });
  it('viewer(solta) === resolveLeaderIdsOf(dono) p/ todos — uma fonte de verdade', () => {
    for (const c of all.filter(x => !x.is_ceo && x.is_active !== false)) {
      const viewers = governanceViewerIdsOf({ governance_owner_id: null, assigned_to: c.id }, c, all).sort();
      const leaders = resolveLeaderIdsOf(c, all).sort();
      expect(viewers).toEqual(leaders);
    }
  });
});
