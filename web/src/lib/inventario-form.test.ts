import { describe, it, expect } from 'vitest';
import { normalizeQuantidade, normalizeAlertaDias } from './inventario-form';

describe('normalizeQuantidade', () => {
  it('valor digitado válido é preservado', () => {
    expect(normalizeQuantidade('2')).toBe(2);
    expect(normalizeQuantidade('102')).toBe(102);
    expect(normalizeQuantidade(5)).toBe(5);
  });
  it('vazio → 1 (default ao salvar, mas permite limpar durante a edição)', () => {
    expect(normalizeQuantidade('')).toBe(1);
  });
  it('zero/negativo → 1 (mínimo)', () => {
    expect(normalizeQuantidade('0')).toBe(1);
    expect(normalizeQuantidade('-3')).toBe(1);
  });
  it('lixo não-numérico → 1', () => {
    expect(normalizeQuantidade('abc')).toBe(1);
    expect(normalizeQuantidade(null)).toBe(1);
    expect(normalizeQuantidade(undefined)).toBe(1);
  });
  it('decimal vira inteiro', () => {
    expect(normalizeQuantidade('3.9')).toBe(3);
  });
});

describe('normalizeAlertaDias', () => {
  it('valor válido é preservado', () => {
    expect(normalizeAlertaDias('45')).toBe(45);
    expect(normalizeAlertaDias(7)).toBe(7);
  });
  it('vazio → 30 (default)', () => {
    expect(normalizeAlertaDias('')).toBe(30);
  });
  it('zero é válido (alertar no próprio dia)', () => {
    expect(normalizeAlertaDias('0')).toBe(0);
  });
  it('negativo → 30', () => {
    expect(normalizeAlertaDias('-5')).toBe(30);
  });
  it('lixo não-numérico → 30', () => {
    expect(normalizeAlertaDias('abc')).toBe(30);
    expect(normalizeAlertaDias(null)).toBe(30);
  });
});
