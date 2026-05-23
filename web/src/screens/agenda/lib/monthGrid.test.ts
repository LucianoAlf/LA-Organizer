import { describe, it, expect } from 'vitest';
import { getMonthGrid } from './monthGrid';

describe('getMonthGrid', () => {
  it('Maio 2026 → 35 ou 42 células, começando num domingo', () => {
    const grid = getMonthGrid(new Date(2026, 4, 1));
    expect([35, 42]).toContain(grid.length);
    expect(grid[0].getDay()).toBe(0);
  });
  it('Maio 2026 dia 1 é sexta → primeira linha começa em 26/04', () => {
    const grid = getMonthGrid(new Date(2026, 4, 1));
    expect(grid[0].toISOString().slice(0, 10)).toBe('2026-04-26');
    expect(grid[5].toISOString().slice(0, 10)).toBe('2026-05-01');
  });
});
