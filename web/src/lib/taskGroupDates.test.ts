import { describe, it, expect } from 'vitest'
import { childDueDateForCycle, cycleLabel, dayOfMonthToYmd, withMonthDayAnchor } from './taskGroupDates'

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

// Editar o prazo do grupo com escopo "esta e as futuras" precisa reancorar a RRULE
// do template — senão o próximo ciclo nasce no dia VELHO e a edição "reverte sozinha"
// (materializeSeriesClient usa template.recurrence_rule pra gerar as ocorrências).
describe('withMonthDayAnchor', () => {
  it('troca o BYMONTHDAY preservando o resto da regra', () => {
    expect(withMonthDayAnchor('FREQ=MONTHLY;BYMONTHDAY=10', 20)).toBe('FREQ=MONTHLY;BYMONTHDAY=20')
    expect(withMonthDayAnchor('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=5', 28))
      .toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28')
  })
  it('acrescenta a âncora quando a regra não tem BYMONTHDAY', () => {
    expect(withMonthDayAnchor('FREQ=MONTHLY', 15)).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
  })
  it('aceita a chave em minúscula e o prefixo RRULE:', () => {
    expect(withMonthDayAnchor('RRULE:FREQ=MONTHLY;bymonthday=3', 9)).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=9')
  })
  it('regra ausente → null (não inventa recorrência)', () => {
    expect(withMonthDayAnchor(null, 12)).toBeNull()
    expect(withMonthDayAnchor('', 12)).toBeNull()
  })
  it('dia fora de 1-31 → devolve a regra intacta', () => {
    expect(withMonthDayAnchor('FREQ=MONTHLY;BYMONTHDAY=10', 0)).toBe('FREQ=MONTHLY;BYMONTHDAY=10')
    expect(withMonthDayAnchor('FREQ=MONTHLY;BYMONTHDAY=10', 32)).toBe('FREQ=MONTHLY;BYMONTHDAY=10')
  })
})

describe('cycleLabel', () => {
  it('nome do mês em pt-BR a partir do due da mãe-instância', () => {
    expect(cycleLabel('2026-06-26')).toBe('junho')
    expect(cycleLabel('2026-01-01')).toBe('janeiro')
  })
})
