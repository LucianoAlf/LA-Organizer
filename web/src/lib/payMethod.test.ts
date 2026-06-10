import { describe, it, expect } from 'vitest';
import { parsePayMethod } from './payMethod';

describe('parsePayMethod', () => {
  it('none → sem carteira', () => {
    expect(parsePayMethod('none')).toEqual({ kind: 'none' });
  });
  it('acc:<id> → carteira', () => {
    expect(parsePayMethod('acc:abc-123')).toEqual({ kind: 'account', id: 'abc-123' });
  });
  it('card:<id> → cartão', () => {
    expect(parsePayMethod('card:xyz-9')).toEqual({ kind: 'card', id: 'xyz-9' });
  });
  it('vazio/desconhecido → none', () => {
    expect(parsePayMethod('')).toEqual({ kind: 'none' });
    expect(parsePayMethod('lixo')).toEqual({ kind: 'none' });
  });
});
