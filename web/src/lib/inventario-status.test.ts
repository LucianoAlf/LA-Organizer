import { describe, it, expect } from 'vitest';
import { proximaRevisaoLimite, aplicaFiltroStatus, statusRevisao } from './inventario-status';

describe('proximaRevisaoLimite', () => {
  it('retorna hoje+30d em YYYY-MM-DD', () => {
    expect(proximaRevisaoLimite(new Date('2026-06-22T12:00:00Z'))).toBe('2026-07-22');
  });
});

describe('aplicaFiltroStatus', () => {
  function makeQ() {
    const calls: Array<[string, string, unknown]> = [];
    const q: any = {
      eq: (c: string, v: unknown) => { calls.push(['eq', c, v]); return q; },
      lte: (c: string, v: unknown) => { calls.push(['lte', c, v]); return q; },
      calls,
    };
    return q;
  }
  it('atencao: sempre ativo=true + lte proxima_revisao', () => {
    const q = makeQ();
    aplicaFiltroStatus(q, 'atencao', new Date('2026-06-22T12:00:00Z'));
    expect(q.calls).toContainEqual(['eq', 'ativo', true]);
    expect(q.calls).toContainEqual(['lte', 'proxima_revisao', '2026-07-22']);
  });
  it('manutencao: sempre ativo=true + eq status', () => {
    const q = makeQ();
    aplicaFiltroStatus(q, 'manutencao');
    expect(q.calls).toContainEqual(['eq', 'ativo', true]);
    expect(q.calls).toContainEqual(['eq', 'status', 'manutencao']);
  });
});

describe('statusRevisao', () => {
  const hoje = new Date(2026, 5, 22); // 22/06/2026 local
  it('passado → venceu há Nd / danger', () => {
    expect(statusRevisao('2026-06-17', hoje)).toEqual({ texto: 'Revisão venceu há 5d', tom: 'danger' });
  });
  it('hoje → vence hoje / danger', () => {
    expect(statusRevisao('2026-06-22', hoje)).toEqual({ texto: 'Revisão vence hoje', tom: 'danger' });
  });
  it('futuro → em Nd / warning', () => {
    expect(statusRevisao('2026-06-30', hoje)).toEqual({ texto: 'Revisão em 8d', tom: 'warning' });
  });
  it('null → null', () => {
    expect(statusRevisao(null, hoje)).toBeNull();
  });
});
