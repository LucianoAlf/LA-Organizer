import { describe, it, expect } from 'vitest';
import { applyTemplate, normalizeTemplateName, canManageTemplate } from './checklistTemplates';

describe('applyTemplate', () => {
  it('preenche rascunho vazio com os itens do modelo', () => {
    expect(applyTemplate([], ['a', 'b'])).toEqual(['a', 'b']);
  });
  it('faz append preservando itens já digitados', () => {
    expect(applyTemplate(['x'], ['a', 'b'])).toEqual(['x', 'a', 'b']);
  });
  it('não duplica item que já existe (match exato com trim)', () => {
    expect(applyTemplate(['Mensagem enviada'], ['Mensagem enviada ', 'Cliente respondeu']))
      .toEqual(['Mensagem enviada', 'Cliente respondeu']);
  });
});

describe('normalizeTemplateName', () => {
  it('trim + aceita 2..80', () => expect(normalizeTemplateName('  Experimental ')).toBe('Experimental'));
  it('rejeita curto', () => expect(normalizeTemplateName(' a ')).toBeNull());
  it('rejeita > 80', () => expect(normalizeTemplateName('x'.repeat(81))).toBeNull());
});

describe('canManageTemplate', () => {
  const t = { created_by: 'u1' };
  it('criador pode', () => expect(canManageTemplate(t, 'u1', 'collaborator')).toBe(true));
  it('coord/director podem', () => {
    expect(canManageTemplate(t, 'u2', 'coordinator')).toBe(true);
    expect(canManageTemplate(t, 'u2', 'director')).toBe(true);
  });
  it('manager NÃO (espelha RLS)', () => expect(canManageTemplate(t, 'u2', 'manager')).toBe(false));
});
