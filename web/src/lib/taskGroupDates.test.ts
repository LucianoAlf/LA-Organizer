import { describe, it, expect } from 'vitest'
import { childDueDateForCycle, cycleLabel, dayOfMonthToYmd } from './taskGroupDates'

describe('childDueDateForCycle', () => {
  it('preserva o dia-do-mês da filha no mês do ciclo (caso Rose)', () => {
    expect(childDueDateForCycle('2026-06-12', '2026-07-26')).toBe('2026-07-12')
  })
  it('clamp em mês curto: dia 31 → 30 em junho', () => {
    expect(childDueDateForCycle('2026-05-31', '2026-06-01')).toBe('2026-06-30')
  })
  it('clamp fevereiro: dia 30 → 28 (2027 não-bissexto)', () => {
    expect(childDueDateForCycle('2026-12-30', '2027-02-01')).toBe('2027-02-28')
  })
  it('virada de ano: filha dia 5, ciclo jan/2027', () => {
    expect(childDueDateForCycle('2026-12-05', '2027-01-26')).toBe('2027-01-05')
  })
})

describe('dayOfMonthToYmd', () => {
  it('dia 12 no mês de 2026-06 → 2026-06-12', () => {
    expect(dayOfMonthToYmd(12, '2026-06-09')).toBe('2026-06-12')
  })
  it('clamp: dia 31 em junho → 30', () => {
    expect(dayOfMonthToYmd(31, '2026-06-09')).toBe('2026-06-30')
  })
})

describe('cycleLabel', () => {
  it('nome do mês em pt-BR a partir do due da mãe-instância', () => {
    expect(cycleLabel('2026-06-26')).toBe('junho')
    expect(cycleLabel('2026-01-01')).toBe('janeiro')
  })
})
