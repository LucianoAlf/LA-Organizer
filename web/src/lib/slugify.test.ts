import { describe, it, expect } from 'vitest';
import { toSlug, uniqueSlug } from './slugify';

describe('toSlug', () => {
  it('normaliza acento/espaço/maiúscula', () => {
    expect(toSlug('Shows')).toBe('shows');
    expect(toSlug('Aulas Particulares')).toBe('aulas_particulares');
    expect(toSlug('Café & Cia')).toBe('cafe_cia');
  });
});
describe('uniqueSlug', () => {
  it('mantém quando livre', () => { expect(uniqueSlug('shows', new Set())).toBe('shows'); });
  it('sufixa quando colide', () => {
    expect(uniqueSlug('shows', new Set(['shows']))).toBe('shows_2');
    expect(uniqueSlug('shows', new Set(['shows','shows_2']))).toBe('shows_3');
  });
});
