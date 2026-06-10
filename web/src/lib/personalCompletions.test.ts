// Testes de cycleAnchor — a data-âncora do ciclo corrente de uma lista recorrente.
// Caso Rose 09/06: lista monthly day=5; marcar no dia 9 tem que cair no ciclo
// de junho (2026-06-05), não na completion volátil de "hoje".
import { describe, it, expect } from 'vitest'
import { cycleAnchor, dowPersonal } from './personalCompletions'
import type { PersonalChecklist } from '../types'

function mk(over: Partial<PersonalChecklist>): Pick<PersonalChecklist, 'recurrence_type' | 'days_of_week' | 'day_of_month'> {
  return {
    recurrence_type: 'daily',
    days_of_week: null,
    day_of_month: null,
    ...over,
  } as Pick<PersonalChecklist, 'recurrence_type' | 'days_of_week' | 'day_of_month'>
}

describe('dowPersonal (sanidade da convenção 1=Dom…7=Sáb)', () => {
  it('2026-06-08 é segunda (2) e 2026-06-09 é terça (3)', () => {
    expect(dowPersonal('2026-06-08')).toBe(2)
    expect(dowPersonal('2026-06-09')).toBe(3)
  })
})

describe('cycleAnchor', () => {
  it('daily → o próprio dia', () => {
    expect(cycleAnchor(mk({ recurrence_type: 'daily' }), '2026-06-09')).toBe('2026-06-09')
  })

  it('once/desconhecida → o próprio dia (caminho nunca usado pra once)', () => {
    expect(cycleAnchor(mk({ recurrence_type: 'once' }), '2026-06-09')).toBe('2026-06-09')
  })

  describe('monthly', () => {
    const m5 = mk({ recurrence_type: 'monthly', day_of_month: 5 })
    it('depois do dia-alvo → alvo do mês corrente (caso Rose: dia 9 → dia 5)', () => {
      expect(cycleAnchor(m5, '2026-06-09')).toBe('2026-06-05')
    })
    it('no dia-alvo → o próprio alvo', () => {
      expect(cycleAnchor(m5, '2026-06-05')).toBe('2026-06-05')
    })
    it('antes do dia-alvo → alvo do mês ANTERIOR (ciclo ainda é o de maio)', () => {
      expect(cycleAnchor(m5, '2026-06-04')).toBe('2026-05-05')
    })
    it('virada de ano: 03/01 com alvo 5 → 05/12 do ano anterior', () => {
      expect(cycleAnchor(m5, '2026-01-03')).toBe('2025-12-05')
    })
    it('dia 31 em mês de 30: clampa pro último dia do mês', () => {
      const m31 = mk({ recurrence_type: 'monthly', day_of_month: 31 })
      expect(cycleAnchor(m31, '2026-06-30')).toBe('2026-06-30')
      // 01/07 ainda não chegou no alvo de julho (31) → ciclo anterior = 30/06
      expect(cycleAnchor(m31, '2026-07-01')).toBe('2026-06-30')
    })
    it('sem day_of_month → assume dia 1', () => {
      const m = mk({ recurrence_type: 'monthly', day_of_month: null })
      expect(cycleAnchor(m, '2026-06-09')).toBe('2026-06-01')
    })
  })

  describe('weekly', () => {
    it('ocorrência mais recente ≤ hoje (lista de segunda, hoje terça → ontem)', () => {
      const w = mk({ recurrence_type: 'weekly', days_of_week: [2] }) // 2 = segunda
      expect(cycleAnchor(w, '2026-06-09')).toBe('2026-06-08')
    })
    it('no próprio dia da recorrência → hoje', () => {
      const w = mk({ recurrence_type: 'weekly', days_of_week: [2] })
      expect(cycleAnchor(w, '2026-06-08')).toBe('2026-06-08')
    })
    it('antes da ocorrência da semana → a da semana passada', () => {
      const w = mk({ recurrence_type: 'weekly', days_of_week: [2] })
      // 2026-06-07 é domingo (1) → segunda mais recente = 01/06
      expect(cycleAnchor(w, '2026-06-07')).toBe('2026-06-01')
    })
    it('multi-dia (seg+sex): pega a mais recente', () => {
      const w = mk({ recurrence_type: 'weekly', days_of_week: [2, 6] }) // seg, sex
      expect(cycleAnchor(w, '2026-06-09')).toBe('2026-06-08')   // terça → seg
      expect(cycleAnchor(w, '2026-06-13')).toBe('2026-06-12')   // sábado → sex
    })
    it('days_of_week vazio → fallback hoje', () => {
      const w = mk({ recurrence_type: 'weekly', days_of_week: [] })
      expect(cycleAnchor(w, '2026-06-09')).toBe('2026-06-09')
    })
  })
})
