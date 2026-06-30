import { describe, it, expect } from 'vitest';
import { diffWatchers } from './taskWatchers';

describe('diffWatchers', () => {
  it('detecta adições e remoções', () => {
    expect(diffWatchers(['a', 'b'], ['b', 'c'])).toEqual({ add: ['c'], remove: ['a'] });
  });
  it('sem mudança → vazio', () => {
    expect(diffWatchers(['a', 'b'], ['b', 'a'])).toEqual({ add: [], remove: [] });
  });
  it('lista atual vazia → tudo é add', () => {
    expect(diffWatchers([], ['x', 'y'])).toEqual({ add: ['x', 'y'], remove: [] });
  });
  it('próxima vazia → tudo é remove', () => {
    expect(diffWatchers(['x'], [])).toEqual({ add: [], remove: ['x'] });
  });
  it('ignora duplicatas', () => {
    expect(diffWatchers(['a'], ['a', 'a', 'b'])).toEqual({ add: ['b'], remove: [] });
  });
});
