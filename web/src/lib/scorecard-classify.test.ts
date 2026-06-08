import { describe, it, expect } from 'vitest';
import { classifyScorecard, type ScoreLite } from './scorecard-classify';

const S = (p: Partial<ScoreLite>): ScoreLite => ({ closure_rate: 1, tasks_closed: 0, tasks_overdue: 0, tasks_stuck: 0, ...p });

describe('classifyScorecard (port scorecard-builder.js:202-209)', () => {
  it('🔴 atenção: closure < 0.60', () => {
    expect(classifyScorecard(S({ closure_rate: 0.29, tasks_closed: 2, tasks_overdue: 5 }))).toBe('atencao');
  });
  it('🔴 atenção: 3+ atrasadas mesmo com closure alto', () => {
    expect(classifyScorecard(S({ closure_rate: 0.9, tasks_closed: 9, tasks_overdue: 3 }))).toBe('atencao');
  });
  it('🔴 atenção: 2+ travadas', () => {
    expect(classifyScorecard(S({ closure_rate: 0.86, tasks_closed: 6, tasks_stuck: 2 }))).toBe('atencao');
  });
  it('🟡 olhar: closure 0.80 + 1 atrasada (não bate vermelho)', () => {
    expect(classifyScorecard(S({ closure_rate: 0.80, tasks_closed: 4, tasks_overdue: 1 }))).toBe('olhar');
  });
  it('🟡 olhar: 1 atrasada com closure alto', () => {
    expect(classifyScorecard(S({ closure_rate: 0.95, tasks_closed: 10, tasks_overdue: 1 }))).toBe('olhar');
  });
  it('🟢 ritmo: sem tarefas', () => {
    expect(classifyScorecard(S({}))).toBe('ritmo');
  });
  it('🟢 ritmo: 100% sem atraso', () => {
    expect(classifyScorecard(S({ closure_rate: 1, tasks_closed: 8 }))).toBe('ritmo');
  });
});
