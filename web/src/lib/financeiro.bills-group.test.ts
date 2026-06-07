import { describe, it, expect } from 'vitest';
import { groupExpenseBillsByStatus, type PfBill } from './financeiro';

const mk = (o: Partial<PfBill>): PfBill => ({ id:'x', name:'x', amount:100, due_day:10, category:'outros' as any, type:'expense', status:'pending', last_paid_at:null, recurrence:'monthly', due_date:null, ...o });
const today = new Date(Date.UTC(2026, 3, 10)); // 10 abril

describe('groupExpenseBillsByStatus', () => {
  it('agrupa despesas por status e ignora receitas', () => {
    const bills = [
      mk({ id:'a', name:'Aluguel', due_day:5 }),                    // atrasada (5<10)
      mk({ id:'b', name:'Internet', due_day:25 }),                  // a-vencer
      mk({ id:'c', name:'Luz', due_day:5, last_paid_at:'2026-04-02' }), // paga (pagou no mês)
      mk({ id:'d', name:'Salário', type:'income', due_day:5 }),     // income → ignorado
    ];
    const g = groupExpenseBillsByStatus(bills, today);
    expect(g.atrasadas.map(b=>b.id)).toEqual(['a']);
    expect(g.aVencer.map(b=>b.id)).toEqual(['b']);
    expect(g.pagas.map(b=>b.id)).toEqual(['c']);
  });
});
