import { describe, it, expect } from 'vitest';
import { canDelegateOwnTask } from './delegatePermission';

const ME = 'me-1';

describe('canDelegateOwnTask (alinhado com a criação — sem exigir coord)', () => {
  it('delega a PRÓPRIA tarefa ativa (qualquer cargo, inclusive farmer/collaborator)', () => {
    expect(canDelegateOwnTask(ME, { assigned_to: ME, status: 'pending' })).toBe(true);
    expect(canDelegateOwnTask(ME, { assigned_to: ME, status: 'in_progress' })).toBe(true);
  });

  it('NÃO delega tarefa de outra pessoa (posse)', () => {
    expect(canDelegateOwnTask(ME, { assigned_to: 'outro', status: 'pending' })).toBe(false);
  });

  it('NÃO delega tarefa concluída / cancelada / já delegada', () => {
    expect(canDelegateOwnTask(ME, { assigned_to: ME, status: 'done' })).toBe(false);
    expect(canDelegateOwnTask(ME, { assigned_to: ME, status: 'cancelled' })).toBe(false);
    expect(canDelegateOwnTask(ME, { assigned_to: ME, status: 'delegated' })).toBe(false);
  });

  it('sem usuário logado ou sem tarefa → false', () => {
    expect(canDelegateOwnTask(null, { assigned_to: ME, status: 'pending' })).toBe(false);
    expect(canDelegateOwnTask(undefined, { assigned_to: ME, status: 'pending' })).toBe(false);
    expect(canDelegateOwnTask(ME, null)).toBe(false);
  });

  it('status ausente + tarefa sua → pode (não bloqueia por falta de status)', () => {
    expect(canDelegateOwnTask(ME, { assigned_to: ME })).toBe(true);
  });
});
