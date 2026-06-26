import { describe, it, expect } from 'vitest';
import { taskDetailMeta } from './taskDetail';

const ME = 'me-1';

describe('taskDetailMeta', () => {
  it('grupo: assigned_group_id → "👥 grupo · criada por X"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: null, created_by: 'c-9', assigned_group_id: 'g-1', groupName: 'ADM CG', creatorName: 'Vitoria Souza' });
    expect(m.kind).toBe('group');
    expect(m.label).toBe('👥 ADM CG · criada por Vitoria');
  });

  it('grupo sem nome do criador → só o grupo', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: null, created_by: null, assigned_group_id: 'g-1', groupName: 'ADM CG' });
    expect(m.label).toBe('👥 ADM CG');
  });

  it('delegada PRA mim (assigned=me, criada por outro) → "Delegada por X"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: ME, created_by: 'c-9', creatorName: 'Rose Lima' });
    expect(m.kind).toBe('delegated');
    expect(m.label).toBe('Delegada por Rose');
  });

  it('delegada POR mim (criada por mim, atribuída a outro) → "Delegada para Y"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: 'o-2', created_by: ME, assigneeName: 'João Pedro' });
    expect(m.kind).toBe('delegated');
    expect(m.label).toBe('Delegada para João');
  });

  it('pessoal: criada e atribuída a mim → "Pessoal"', () => {
    const m = taskDetailMeta({ meId: ME, assigned_to: ME, created_by: ME });
    expect(m).toEqual({ kind: 'personal', label: 'Pessoal' });
  });
});
