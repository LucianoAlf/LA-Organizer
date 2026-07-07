// TDD — Modelos de tarefa pessoais (spec 2026-07-07-task-templates-design.md).
// Guardrails testados: data/recorrência NUNCA entram no payload; ids envelhecidos
// saem com warning ao aplicar; payload de versão antiga não quebra.
import { describe, expect, it } from 'vitest';
import { formPatchFromPayload, isSnapshotEmpty, payloadFromSnapshot } from './taskTemplates';

const REFS = {
  collabIds: new Set(['c1', 'c2']),
  categoryIds: new Set(['cat1']),
  groupIds: new Set(['g1']),
};

describe('payloadFromSnapshot', () => {
  it('whitelist: due e recurrenceRule ficam de fora em todos os kinds', () => {
    const snap = { title: 'Novo Lead', due: '2026-07-07', recurrenceRule: 'FREQ=DAILY', time: '09:00' };
    for (const kind of ['task', 'event', 'delegated', 'group'] as const) {
      const p = payloadFromSnapshot(kind, snap);
      expect(p.due).toBeUndefined();
      expect(p.recurrenceRule).toBeUndefined();
    }
  });

  it('delegated mantém delegate_to/cc_ids; task não', () => {
    const snap = { title: 'x', delegate_to: 'c1', cc_ids: ['c2'] };
    expect(payloadFromSnapshot('delegated', snap)).toMatchObject({ delegate_to: 'c1', cc_ids: ['c2'] });
    const t = payloadFromSnapshot('task', snap);
    expect(t.delegate_to).toBeUndefined();
    expect(t.cc_ids).toBeUndefined();
  });

  it('descarta vazios (null, "", undefined) mas mantém false/0/arrays', () => {
    const p = payloadFromSnapshot('task', {
      title: 'x', description: '', group_id: null, group_mode: false, quadrant: 0, checklist: [],
    });
    expect(p).toEqual({ title: 'x', group_mode: false, quadrant: 0, checklist: [] });
  });
});

describe('isSnapshotEmpty', () => {
  it('true sem título e sem checklist/children', () => {
    expect(isSnapshotEmpty({ title: '  ', checklist: [] })).toBe(true);
    expect(isSnapshotEmpty({})).toBe(true);
  });
  it('false com título OU com checklist OU com children', () => {
    expect(isSnapshotEmpty({ title: 'x' })).toBe(false);
    expect(isSnapshotEmpty({ checklist: ['a'] })).toBe(false);
    expect(isSnapshotEmpty({ children: [{ title: 'a' }] })).toBe(false);
  });
});

describe('formPatchFromPayload', () => {
  it('delegado que saiu do time: remove + warning', () => {
    const { patch, warnings } = formPatchFromPayload('delegated', { title: 'x', delegate_to: 'sumiu' }, REFS);
    expect(patch.delegate_to).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('cc_ids/participant_ids parcialmente inválidos: filtra + warning', () => {
    const d = formPatchFromPayload('delegated', { title: 'x', cc_ids: ['c1', 'sumiu'] }, REFS);
    expect(d.patch.cc_ids).toEqual(['c1']);
    expect(d.warnings).toHaveLength(1);
    const e = formPatchFromPayload('event', { title: 'x', participant_ids: ['c2', 'zz'] }, REFS);
    expect(e.patch.participant_ids).toEqual(['c2']);
    expect(e.warnings).toHaveLength(1);
  });

  it('category_id inexistente: limpa com warning suave', () => {
    const { patch, warnings } = formPatchFromPayload('event', { title: 'x', category_id: 'morta' }, REFS);
    expect(patch.category_id).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('group_id inexistente: limpa, desliga group_mode e avisa', () => {
    const { patch, warnings } = formPatchFromPayload('task', { title: 'x', group_id: 'morto', group_mode: true }, REFS);
    expect(patch.group_id).toBeUndefined();
    expect(patch.group_mode).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('payload íntegro passa limpo, sem warnings', () => {
    const { patch, warnings } = formPatchFromPayload('delegated', {
      title: 'Novo Lead', delegate_to: 'c1', cc_ids: ['c2'], checklist: ['a', 'b'], time: '09:00',
    }, REFS);
    expect(patch).toMatchObject({ title: 'Novo Lead', delegate_to: 'c1', cc_ids: ['c2'] });
    expect(warnings).toHaveLength(0);
  });

  it('payload antigo com campo desconhecido: ignorado sem erro (re-whitelist)', () => {
    const { patch } = formPatchFromPayload('task', { title: 'x', campo_de_2027: 'zz', due: '2026-01-01' }, REFS);
    expect(patch).toEqual({ title: 'x' });
  });
});
