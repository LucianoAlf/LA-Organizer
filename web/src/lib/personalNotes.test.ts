import { describe, it, expect } from 'vitest';
import { buildTypeIndex, templateForType, resolveColor, isEncrypted } from './personalNotes';

describe('personalNotes (re-exports + índice por usuário)', () => {
  it('buildTypeIndex: 5 base + tipo custom do usuário (sem group_id)', () => {
    const idx = buildTypeIndex([{ key: 'streaming', label: 'Streaming', color: '#E24B4A', icon: 'Star', fields: [] }]);
    expect(idx.acesso.label).toBe('Acesso');
    expect(idx.streaming.label).toBe('Streaming');
    expect(idx.streaming.color).toBe('#E24B4A');
  });
  it('templateForType("acesso") tem um campo secret (senha)', () => {
    expect(templateForType('acesso').some((f) => f.secret)).toBe(true);
  });
  it('resolveColor usa override → tipo → fallback', () => {
    expect(resolveColor({ type: 'acesso', color: '#123456' })).toBe('#123456');
    expect(resolveColor({ type: 'livre', color: null })).toBeTruthy();
  });
  it('isEncrypted detecta enc:v1:', () => {
    expect(isEncrypted('enc:v1:abc')).toBe(true);
    expect(isEncrypted('net1234')).toBe(false);
  });
});
