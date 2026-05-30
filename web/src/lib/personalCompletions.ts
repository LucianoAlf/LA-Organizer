// web/src/lib/personalCompletions.ts
// Sprint Checklist-Diário — liga listas pessoais RECORRENTES ao modelo de
// completion por dia (espelha op_checklist_completions do trabalho).
// 'once' continua no modelo estático (is_done) — ver personalChecklists.ts.
import { supabase } from './supabase'
import { todaySP } from '../utils/date'
import type { PersonalChecklist } from '../types'

/** Dia da semana de um YMD na convenção do RecurrenceField: 1=Dom … 7=Sáb. */
export function dowPersonal(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  // meio-dia UTC evita drift de fuso; getUTCDay: 0=Dom..6=Sáb → +1 = 1..7
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 1
}

function lastDayOfMonth(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** A lista recorrente "vale" para o YMD informado? 'once' nunca usa este caminho. */
export function recurrenceAppliesToday(list: PersonalChecklist, ymd = todaySP()): boolean {
  switch (list.recurrence_type) {
    case 'daily':
      return true
    case 'weekly':
      return (list.days_of_week ?? []).includes(dowPersonal(ymd))
    case 'monthly': {
      const dom = Number(ymd.split('-')[2])
      const target = list.day_of_month ?? 1
      if (dom === target) return true
      // dia 31 em mês de 30/Fev: dispara no último dia do mês.
      return target > lastDayOfMonth(ymd) && dom === lastDayOfMonth(ymd)
    }
    default:
      return false
  }
}

/**
 * get-or-create REAL da completion do dia: SELECT primeiro, INSERT só se faltar.
 * ⚠️ NUNCA chamar no caminho de LEITURA — só no toggle/escrita. Steady-state = 0
 * escrita (sem isto, o realtime entra em loop refetch→escreve→evento→refetch).
 * user_id = collabId.
 */
export async function ensurePersonalCompletion(
  checklistId: string,
  collabId: string,
  ymd = todaySP(),
): Promise<{ id: string }> {
  const { data: existing, error: e1 } = await supabase
    .from('personal_checklist_completions')
    .select('id')
    .eq('checklist_id', checklistId)
    .eq('user_id', collabId)
    .eq('reference_date', ymd)
    .maybeSingle()
  if (e1) throw e1
  if (existing) return existing as { id: string }

  const { data: created, error: e2 } = await supabase
    .from('personal_checklist_completions')
    .insert({ checklist_id: checklistId, user_id: collabId, reference_date: ymd, channel: 'pwa' })
    .select('id')
    .single()
  if (e2) throw e2
  return created as { id: string }
}

/** Marca/desmarca item recorrente no dia (upsert em item_completions). */
export async function togglePersonalCompletionItem(
  completionId: string,
  itemId: string,
  isChecked: boolean,
) {
  const { error } = await supabase
    .from('personal_checklist_item_completions')
    .upsert(
      {
        completion_id: completionId,
        item_id: itemId,
        is_checked: isChecked,
        checked_at: isChecked ? new Date().toISOString() : null,
      },
      { onConflict: 'completion_id,item_id' },
    )
  if (error) throw error
}

/**
 * Busca listas pessoais do dia para o caminho "Hoje". LEITURA PURA — NÃO escreve.
 * - 'once': retorna como está (is_done estático).
 * - recorrente que NÃO vale hoje: filtrada fora.
 * - recorrente que vale hoje: LÊ a completion de hoje se já existir e faz overlay
 *   de is_checked em cada item. Se NÃO existir completion → todos os itens caem em
 *   is_done=false, que é exatamente o reset do dia. (A completion só é criada no
 *   1º toggle, via ensurePersonalCompletion no card/engine — nunca aqui.)
 */
export async function fetchPersonalChecklistsHoje(
  collabId: string,
  context: 'personal' | 'work',
): Promise<PersonalChecklist[]> {
  const ymd = todaySP()
  const { data, error } = await supabase
    .from('personal_checklists')
    .select('*, personal_checklist_items (*)')
    .eq('owner_collab_id', collabId)
    .eq('context', context)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  const lists = (data ?? []) as PersonalChecklist[]

  const out: PersonalChecklist[] = []
  for (const list of lists) {
    if (list.recurrence_type === 'once') {
      out.push(list)
      continue
    }
    if (!recurrenceAppliesToday(list, ymd)) continue // não aparece hoje

    // LEITURA PURA: lê a completion de hoje SE existir (maybeSingle). Não cria.
    const { data: comp, error: e2 } = await supabase
      .from('personal_checklist_completions')
      .select('id, personal_checklist_item_completions ( item_id, is_checked )')
      .eq('checklist_id', list.id)
      .eq('user_id', collabId)
      .eq('reference_date', ymd)
      .maybeSingle()
    if (e2) throw e2

    const checkedMap = new Map(
      ((comp as any)?.personal_checklist_item_completions ?? []).map((c: any) => [c.item_id, !!c.is_checked]),
    )
    out.push({
      ...list,
      today_completion_id: (comp as any)?.id ?? null,
      personal_checklist_items: (list.personal_checklist_items ?? []).map((it) => ({
        ...it,
        is_done: checkedMap.get(it.id) ?? false, // sem completion → false (reset do dia)
      })),
    })
  }
  return out
}

export interface PersonalHistoryDay {
  reference_date: string
  total: number
  done: number
  pct: number
  items: Array<{ id: string; description: string; is_checked: boolean }>
}

/** Histórico dia-a-dia de uma lista recorrente (desc por data). */
export async function fetchPersonalHistory(
  checklistId: string,
  collabId: string,
  limit = 30,
): Promise<PersonalHistoryDay[]> {
  const { data: comps, error } = await supabase
    .from('personal_checklist_completions')
    .select(`
      id, reference_date,
      personal_checklist_item_completions ( item_id, is_checked ),
      personal_checklists!inner (
        personal_checklist_items ( id, description, sort_order )
      )
    `)
    .eq('checklist_id', checklistId)
    .eq('user_id', collabId)
    .order('reference_date', { ascending: false })
    .limit(limit)
  if (error) throw error

  return (comps ?? []).map((c: any) => {
    const allItems = (c.personal_checklists?.personal_checklist_items ?? [])
      .slice()
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const checkedMap = new Map(
      (c.personal_checklist_item_completions ?? []).map((x: any) => [x.item_id, !!x.is_checked]),
    )
    const items = allItems.map((it: any) => ({
      id: it.id,
      description: it.description,
      is_checked: checkedMap.get(it.id) ?? false,
    }))
    const total = items.length
    const done = items.filter((i: any) => i.is_checked).length
    return {
      reference_date: c.reference_date,
      total,
      done,
      pct: total ? Math.round((done / total) * 100) : 0,
      items,
    }
  })
}
