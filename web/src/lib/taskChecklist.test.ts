import { describe, it, expect } from 'vitest';
import { splitTopLevel, checklistProgress, canCheckItem } from './taskChecklist';

describe('splitTopLevel', () => {
  it('separa topo de filhas e agrupa por pai', () => {
    const tasks = [
      { id: 'p', parent_task_id: null },
      { id: 'c1', parent_task_id: 'p' },
      { id: 'c2', parent_task_id: 'p' },
      { id: 'q', parent_task_id: null },
    ];
    const { top, childrenByParent } = splitTopLevel(tasks);
    expect(top.map(t => t.id)).toEqual(['p', 'q']);
    expect(childrenByParent.get('p')!.map(t => t.id)).toEqual(['c1', 'c2']);
    expect(childrenByParent.has('q')).toBe(false);
  });

  it('regressão: tarefas sem checklist permanecem todas no topo', () => {
    const semChecklist = [{ id: 'a', parent_task_id: null }, { id: 'b', parent_task_id: null }];
    expect(splitTopLevel(semChecklist).top.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('filha de tarefa pessoal nunca entra no topo', () => {
    const mix = [{ id: 'p', parent_task_id: null }, { id: 'c', parent_task_id: 'p' }];
    expect(splitTopLevel(mix).top.map(t => t.id)).toEqual(['p']);
  });
});

describe('checklistProgress', () => {
  it('conta done sobre total (ignora cancelled)', () => {
    expect(checklistProgress([{ status: 'done' }, { status: 'pending' }, { status: 'cancelled' }]))
      .toEqual({ done: 1, total: 2 });
  });
  it('lista vazia => 0/0', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });
});

describe('canCheckItem', () => {
  it('só o responsável marca (pessoal/delegada)', () => {
    expect(canCheckItem({ assigned_to: 'u1', meId: 'u1' })).toBe(true);
    expect(canCheckItem({ assigned_to: 'u1', meId: 'u2' })).toBe(false);
    expect(canCheckItem({ assigned_to: null, meId: 'u1' })).toBe(false);
  });
  it('tarefa de grupo: qualquer membro marca', () => {
    expect(canCheckItem({ assigned_to: null, assigned_group_id: 'g1', meId: 'u9' })).toBe(true);
  });
});
