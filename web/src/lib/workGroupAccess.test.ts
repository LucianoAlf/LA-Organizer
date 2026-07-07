import { describe, it, expect } from 'vitest';
import { canSeeGroup, visibleWorkGroups, canConfigureGroup, isGroupAdmin } from './workGroupAccess';

const G = (id: string, leader: string | null, creator: string | null = null) =>
  ({ id, leader_id: leader, created_by: creator });

const ctx = (role: string, meuId = 'me', myIds: string[] = []) =>
  ({ role, meuId, myGroupIds: new Set(myIds) });

describe('regra de visibilidade (Alf 06/07): só director vê tudo', () => {
  const grupos = [G('fin', 'rose'), G('adm', 'ana'), G('meu', 'me'), G('criei', 'outra', 'me')];

  it('director vê TODOS', () => {
    expect(visibleWorkGroups(grupos, ctx('director'))).toHaveLength(4);
  });

  it('manager (caso Rose) NÃO vê grupos alheios — só membro/líder/criador', () => {
    const rose = { role: 'manager', meuId: 'rose', myGroupIds: new Set(['adm']) };
    const vis = visibleWorkGroups(grupos, rose);
    expect(vis.map(g => g.id).sort()).toEqual(['adm', 'fin']); // membro do adm + líder do fin
  });

  it('coordinator também cai na regra de membro', () => {
    expect(visibleWorkGroups(grupos, ctx('coordinator', 'zeze', []))).toHaveLength(0);
  });

  it('collaborator vê membro + líder + CRIADOR (grupo que criou sem ser membro)', () => {
    const vis = visibleWorkGroups(grupos, ctx('collaborator', 'me', ['fin']));
    expect(vis.map(g => g.id).sort()).toEqual(['criei', 'fin', 'meu']);
  });

  it('sem usuário logado → nada (exceto director, que não existe deslogado)', () => {
    expect(visibleWorkGroups(grupos, { role: 'collaborator', meuId: null, myGroupIds: new Set() })).toHaveLength(0);
  });
});

describe('canSeeGroup / canConfigureGroup', () => {
  const g = G('fin', 'rose', 'quem-criou');

  it('membro vê mas NÃO configura', () => {
    const ana = ctx('collaborator', 'ana', ['fin']);
    expect(canSeeGroup(g, ana)).toBe(true);
    expect(canConfigureGroup(g, ana)).toBe(false);
  });

  it('líder vê e configura', () => {
    const rose = ctx('manager', 'rose', []);
    expect(canSeeGroup(g, rose)).toBe(true);
    expect(canConfigureGroup(g, rose)).toBe(true);
  });

  it('criador vê e configura', () => {
    const c = ctx('collaborator', 'quem-criou', []);
    expect(canSeeGroup(g, c)).toBe(true);
    expect(canConfigureGroup(g, c)).toBe(true);
  });

  it('manager/coordinator SEM vínculo: não vê nem configura', () => {
    const m = ctx('manager', 'fulano', []);
    expect(canSeeGroup(g, m)).toBe(false);
    expect(canConfigureGroup(g, m)).toBe(false);
  });

  it('director vê e configura tudo', () => {
    const d = ctx('director', 'alf', []);
    expect(canSeeGroup(g, d)).toBe(true);
    expect(canConfigureGroup(g, d)).toBe(true);
    expect(isGroupAdmin('director')).toBe(true);
    expect(isGroupAdmin('manager')).toBe(false);
  });
});
