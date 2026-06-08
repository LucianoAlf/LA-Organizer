import { describe, it, expect } from 'vitest';
import {
  normTitle, dedupeRecurringOverdue, filterActiveAssignees,
  countDistinctOverdue, overdueByPerson, type OverdueRow,
} from './governance-metrics';

const rows: OverdueRow[] = [
  { id: '1', title: 'Liberar arte-convite', assigned_to: 'jhon', due_date: '2026-06-02' },
  { id: '2', title: 'Convidar alunos', assigned_to: 'jhon', due_date: '2026-06-02' },
  { id: '3', title: 'Dar presença dos alunos', assigned_to: 'jhon', due_date: '2026-06-05' },
  { id: '4', title: 'Dar presença dos alunos', assigned_to: 'jhon', due_date: '2026-06-03' },
  { id: '5', title: 'DAR  presença  dos alunos', assigned_to: 'jhon', due_date: '2026-06-04' },
  { id: '6', title: 'Montar repertório', assigned_to: 'ju', due_date: '2026-06-06' },
  { id: '7', title: 'Tarefa do inativo', assigned_to: 'kinho', due_date: '2026-06-01' },
];

describe('normTitle', () => {
  it('baixa caixa, tira acento e colapsa espaço', () => {
    expect(normTitle('DAR  presença  dos Alunos')).toBe('dar presenca dos alunos');
  });
});

describe('dedupeRecurringOverdue', () => {
  it('colapsa título igual do mesmo dono em 1 grupo com count e due mais antigo', () => {
    const g = dedupeRecurringOverdue(rows);
    // jhon: arte, convidar, presença(x3) = 3 grupos; ju: 1; kinho: 1 → 5 grupos
    expect(g.length).toBe(5);
    const presenca = g.find(x => x.assigned_to === 'jhon' && x.title.toLowerCase().includes('presen'))!;
    expect(presenca.count).toBe(3);
    expect(presenca.oldestDue).toBe('2026-06-03');
    expect(presenca.recurring).toBe(true);
  });
});

describe('filterActiveAssignees', () => {
  it('remove linhas de quem não está ativo', () => {
    const active = new Set(['jhon', 'ju']);
    expect(filterActiveAssignees(rows, active).some(r => r.assigned_to === 'kinho')).toBe(false);
  });
});

describe('contagem honesta', () => {
  it('countDistinctOverdue = nº de obrigações distintas (recorrência conta 1)', () => {
    const active = new Set(['jhon', 'ju']);
    const g = dedupeRecurringOverdue(filterActiveAssignees(rows, active));
    expect(countDistinctOverdue(g)).toBe(4); // arte, convidar, presença, repertório (kinho fora)
  });
  it('overdueByPerson conta grupos por pessoa, ordenado desc', () => {
    const g = dedupeRecurringOverdue(filterActiveAssignees(rows, new Set(['jhon', 'ju'])));
    const byp = overdueByPerson(g);
    expect(byp[0]).toEqual({ assigned_to: 'jhon', count: 3 });
    expect(byp.find(p => p.assigned_to === 'ju')!.count).toBe(1);
  });
});
