import { describe, it, expect } from 'vitest';
import {
  projectedInstances, shouldWarnUnboundedRecurrence, GUARD_SPAM_THRESHOLD, ehMoldeDeSerie,
} from './recurrenceGuard';

const START = '2026-07-02';

describe('projectedInstances (30d a partir de 2026-07-02)', () => {
  it('diária floda o horizonte (>= limiar)', () => {
    expect(projectedInstances('FREQ=DAILY', START)).toBeGreaterThanOrEqual(GUARD_SPAM_THRESHOLD);
  });
  it('semanal (1 dia) gera poucas (< limiar)', () => {
    expect(projectedInstances('FREQ=WEEKLY;BYDAY=TH', START)).toBeLessThan(GUARD_SPAM_THRESHOLD);
  });
  it('dias úteis floda (>= limiar)', () => {
    expect(projectedInstances('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', START)).toBeGreaterThanOrEqual(GUARD_SPAM_THRESHOLD);
  });
  it('mensal gera 1 (< limiar)', () => {
    expect(projectedInstances('FREQ=MONTHLY;BYMONTHDAY=1', START)).toBeLessThan(GUARD_SPAM_THRESHOLD);
  });
  it('rule/start inválido → 0', () => {
    expect(projectedInstances(null, START)).toBe(0);
    expect(projectedInstances('FREQ=DAILY', '')).toBe(0);
    expect(projectedInstances('lixo-nao-rrule', START)).toBe(0);
  });
});

describe('shouldWarnUnboundedRecurrence', () => {
  it('diária sem fim → avisa, cadência "diária"', () => {
    const w = shouldWarnUnboundedRecurrence('FREQ=DAILY', START);
    expect(w).not.toBeNull();
    expect(w!.cadence).toBe('diária');
    expect(w!.count).toBeGreaterThanOrEqual(GUARD_SPAM_THRESHOLD);
  });
  it('dias úteis sem fim → avisa, cadência "dias úteis"', () => {
    const w = shouldWarnUnboundedRecurrence('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', START);
    expect(w).not.toBeNull();
    expect(w!.cadence).toBe('dias úteis');
  });
  it('semanal (1 dia) → não avisa (poucas ocorrências)', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=WEEKLY;BYDAY=TH', START)).toBeNull();
  });
  it('mensal → não avisa', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=MONTHLY;BYMONTHDAY=1', START)).toBeNull();
  });
  it('diária COM fim (UNTIL) → não avisa (usuário limitou)', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=DAILY;UNTIL=20260705T000000Z', START)).toBeNull();
  });
  it('diária COM COUNT → não avisa', () => {
    expect(shouldWarnUnboundedRecurrence('FREQ=DAILY;COUNT=3', START)).toBeNull();
  });
  it('sem recorrência → não avisa', () => {
    expect(shouldWarnUnboundedRecurrence(null, START)).toBeNull();
    expect(shouldWarnUnboundedRecurrence('', START)).toBeNull();
  });
});

// ── ehMoldeDeSerie: cancelar o molde mata a série em silêncio ────────────────────────
// 09/08/2026, domingo 12:54 BRT: quatro moldes do Financeiro foram cancelados de uma vez
// (Conciliação de Cartões + Repasses Maquininha Barra/CG/Recreio). Nenhum erro, nenhum
// aviso — as tarefas simplesmente parariam de nascer em outubro, meses depois, sem que
// ninguém ligasse uma coisa à outra.
//
// O chat do TOM protege isso desde 17/06 (pickInstanceTarget nunca mira molde). O app
// ficou sem o irmão: cancelTask aceitava qualquer id. Este é o guard que faltava.
describe('ehMoldeDeSerie', () => {
  it('molde recorrente é reconhecido (tem regra e não é instância de ninguém)', () => {
    expect(ehMoldeDeSerie({ recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=30' })).toBe(true);
    expect(ehMoldeDeSerie({ recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=1', recurrence_parent_id: null })).toBe(true);
  });

  it('instância NÃO é molde — é ela que a pessoa quer cancelar', () => {
    expect(ehMoldeDeSerie({ recurrence_rule: null, recurrence_parent_id: 'tpl' })).toBe(false);
    expect(ehMoldeDeSerie({ recurrence_rule: null, recurrence_parent_id: null })).toBe(false);
  });

  // Sutil: uma ocorrência que ganhou regra própria continua sendo ocorrência. Tratá-la como
  // molde bloquearia o cancelamento de uma tarefa que a pessoa PRECISA cancelar.
  it('ocorrência com regra própria e pai não é molde', () => {
    expect(ehMoldeDeSerie({ recurrence_rule: 'FREQ=MONTHLY', recurrence_parent_id: 'tpl' })).toBe(false);
  });

  it('entrada vazia não trava nada', () => {
    expect(ehMoldeDeSerie(null)).toBe(false);
    expect(ehMoldeDeSerie(undefined)).toBe(false);
    expect(ehMoldeDeSerie({})).toBe(false);
  });
});
