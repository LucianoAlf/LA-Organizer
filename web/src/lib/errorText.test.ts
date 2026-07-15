import { describe, it, expect } from 'vitest';
import { errorText } from './errorText';

describe('errorText', () => {
  it('Error próprio → sua mensagem (validação amigável)', () => {
    expect(errorText(new Error('Nome obrigatório.'))).toBe('Nome obrigatório.');
  });
  it('string → a própria string', () => {
    expect(errorText('boom')).toBe('boom');
  });
  it('PostgrestError (objeto) → fallback, NUNCA "[object Object]"', () => {
    const pgErr = { message: 'new row violates check constraint', code: '23514', details: null, hint: null };
    const out = errorText(pgErr, 'Não consegui salvar. Tenta de novo?');
    expect(out).toBe('Não consegui salvar. Tenta de novo?');
    expect(out).not.toContain('[object Object]');
  });
  it('null/undefined → fallback', () => {
    expect(errorText(null, 'x')).toBe('x');
    expect(errorText(undefined, 'x')).toBe('x');
  });
  it('Error sem mensagem → fallback (não string vazia)', () => {
    expect(errorText(new Error(''), 'fallback')).toBe('fallback');
  });
  it('string vazia → fallback', () => {
    expect(errorText('   ', 'fallback')).toBe('fallback');
  });
});
