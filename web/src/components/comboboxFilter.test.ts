import { describe, it, expect } from 'vitest';
import { normalize, filterOptions, shouldOfferCreate } from './comboboxFilter';

describe('normalize', () => {
  it('tira acento, caixa e emoji/símbolo inicial', () => {
    expect(normalize('Água')).toBe('agua');
    expect(normalize('🎤  Shows')).toBe('shows');
    expect(normalize('  Café ')).toBe('cafe');
  });
});

describe('filterOptions', () => {
  const opts = [{ value: 'shows', label: '🎤  Shows' }, { value: 'agua', label: '💧  Água' }];
  it('filtra acento-insensível e ignora emoji', () => {
    expect(filterOptions(opts, 'sho').map((o) => o.value)).toEqual(['shows']);
    expect(filterOptions(opts, 'agua').map((o) => o.value)).toEqual(['agua']);
  });
  it('query vazio devolve tudo', () => {
    expect(filterOptions(opts, '').length).toBe(2);
  });
});

describe('shouldOfferCreate', () => {
  const opts = [{ value: 'shows', label: '🎤  Shows' }];
  it('match exato (ignorando emoji) NÃO oferece criar', () => {
    expect(shouldOfferCreate(opts, 'Shows')).toBe(false);
    expect(shouldOfferCreate(opts, 'shows')).toBe(false);
  });
  it('texto novo oferece criar', () => {
    expect(shouldOfferCreate(opts, 'Aula')).toBe(true);
    expect(shouldOfferCreate(opts, 'sho')).toBe(true);
  });
  it('query vazio não oferece criar', () => {
    expect(shouldOfferCreate(opts, '   ')).toBe(false);
  });
});
