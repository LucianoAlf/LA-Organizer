import { describe, it, expect } from 'vitest';
import { matchBankSlug, logoUrl, BANKS } from '../banks';

describe('matchBankSlug', () => {
  it('casa nome exato e variações', () => {
    expect(matchBankSlug('Nubank')).toBe('nubank');
    expect(matchBankSlug('C6 Bank')).toBe('c6');
    expect(matchBankSlug('Itaú')).toBe('itau');
    expect(matchBankSlug('Mercado Pago')).toBe('mercadopago');
    expect(matchBankSlug('Banco do Brasil')).toBe('bb');
  });
  it('retorna null pra desconhecido/vazio', () => {
    expect(matchBankSlug('Carteira XPTO')).toBeNull();
    expect(matchBankSlug('')).toBeNull();
  });
});
describe('logoUrl', () => {
  it('monta o caminho público', () => { expect(logoUrl('nubank')).toBe('/banks/nubank.svg'); });
});
describe('BANKS', () => {
  it('tem cor pros bancos com svg', () => {
    for (const s of ['nubank','itau','santander','c6','mercadopago']) expect(BANKS[s]?.color).toMatch(/^#/);
  });
});
