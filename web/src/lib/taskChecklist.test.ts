import { describe, it, expect } from 'vitest';
import { splitTopLevel, checklistProgress, canCheckItem, renderChecklistBlock, shouldAutocompleteParent } from './taskChecklist';

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

const C = (title: string, status: string, sort_position: number) => ({ title, status, sort_position });

describe('renderChecklistBlock', () => {
  const five = [
    C('Mensagem enviada para o aluno', 'done', 1),
    C('Aluno respondeu', 'done', 2),
    C('Aluno pagou a mensalidade', 'done', 3),
    C('Trancamento do aluno realizado', 'done', 4),
    C('Confirmar matrícula', 'pending', 5),
  ];
  it('formato exato do mockup, com nome (visão do delegador)', () => {
    expect(renderChecklistBlock(five, { assigneeName: 'John' })).toBe(
      '*Checklist* John: 4/5 ▓▓▓▓░\n' +
      '✅ Mensagem enviada para o aluno\n' +
      '✅ Aluno respondeu\n' +
      '✅ Aluno pagou a mensalidade\n' +
      '✅ Trancamento do aluno realizado\n' +
      '⬜ Confirmar matrícula'
    );
  });
  it('sem nome (visão do próprio executor) → label sem nome', () => {
    expect(renderChecklistBlock(five).split('\n')[0]).toBe('*Checklist:* 4/5 ▓▓▓▓░');
  });
  it('sem itens → string vazia', () => {
    expect(renderChecklistBlock([])).toBe('');
  });
  it('cancelled sai do total e da lista', () => {
    const out = renderChecklistBlock([C('a', 'done', 1), C('b', 'cancelled', 2), C('c', 'pending', 3)]);
    expect(out.split('\n')[0]).toBe('*Checklist:* 1/2 ▓░');
    expect(out).not.toContain('b');
  });
  it('ordena por sort_position', () => {
    const out = renderChecklistBlock([C('segundo', 'pending', 2), C('primeiro', 'pending', 1)]);
    const lines = out.split('\n');
    expect(lines[1]).toBe('⬜ primeiro');
    expect(lines[2]).toBe('⬜ segundo');
  });
  it('N>10 escala a barra (cap 10 segmentos), label exato', () => {
    const big = Array.from({ length: 20 }, (_, i) => C(`i${i}`, i < 4 ? 'done' : 'pending', i + 1));
    expect(renderChecklistBlock(big).split('\n')[0]).toBe('*Checklist:* 4/20 ▓▓░░░░░░░░');
  });
  it('tudo feito → barra cheia', () => {
    expect(renderChecklistBlock([C('a', 'done', 1), C('b', 'done', 2)]).split('\n')[0]).toBe('*Checklist:* 2/2 ▓▓');
  });
});

describe('shouldAutocompleteParent', () => {
  it('todas done → true', () => expect(shouldAutocompleteParent([C('a', 'done', 1), C('b', 'done', 2)])).toBe(true));
  it('uma pendente → false', () => expect(shouldAutocompleteParent([C('a', 'done', 1), C('b', 'pending', 2)])).toBe(false));
  it('vazio → false', () => expect(shouldAutocompleteParent([])).toBe(false));
  it('cancelled ignorado: resto done → true', () => expect(shouldAutocompleteParent([C('a', 'done', 1), C('b', 'cancelled', 2)])).toBe(true));
  it('só cancelled → false (total 0)', () => expect(shouldAutocompleteParent([C('a', 'cancelled', 1)])).toBe(false));
});
