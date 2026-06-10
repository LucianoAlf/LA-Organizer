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

/** YMD ± n dias (meio-dia UTC evita drift de fuso). */
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

/**
 * Data-âncora do CICLO corrente de uma lista recorrente (caso Rose 09/06).
 * O progresso de uma recorrente vale pelo ciclo, não pelo dia do clique:
 * - daily   → o próprio dia (ciclo = dia)
 * - weekly  → a ocorrência mais recente ≤ hoje dentre days_of_week
 * - monthly → o day_of_month do mês corrente se já passou; senão o do mês anterior
 *             (clampado pro último dia em meses curtos)
 * Toggle e leitura usam a MESMA âncora → marcar fora do dia-alvo persiste até o
 * próximo ciclo (não reseta no dia seguinte, não some da tela).
 */
export function cycleAnchor(
  list: Pick<PersonalChecklist, 'recurrence_type' | 'days_of_week' | 'day_of_month'>,
  ymd = todaySP(),
): string {
  switch (list.recurrence_type) {
    case 'daily':
      return ymd
    case 'weekly': {
      const days = list.days_of_week ?? []
      if (days.length === 0) return ymd
      for (let i = 0; i < 7; i++) {
        const d = addDaysYmd(ymd, -i)
        if (days.includes(dowPersonal(d))) return d
      }
      return ymd
    }
    case 'monthly': {
      const target = list.day_of_month ?? 1
      const [y, m, dom] = ymd.split('-').map(Number)
      const pad = (n: number) => String(n).padStart(2, '0')
      // Clampa o alvo pro último dia do mês (alvo 31 em junho → 30).
      const anchorDay = (yy: number, mm: number) =>
        Math.min(target, new Date(Date.UTC(yy, mm, 0)).getUTCDate())
      const cur = anchorDay(y, m)
      if (dom >= cur) return `${y}-${pad(m)}-${pad(cur)}`
      const py = m === 1 ? y - 1 : y
      const pm = m === 1 ? 12 : m - 1
      return `${py}-${pad(pm)}-${pad(anchorDay(py, pm))}`
    }
    default:
      return ymd
  }
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
    // Recorrente é SEMPRE visível; o progresso vale pelo CICLO corrente (cycleAnchor).
    // Antes: filtrava fora-do-dia (lista sumia/ineditável) e lia a completion de HOJE
    // enquanto o toggle gravava nela também — mas a aba Trabalho lia o fetch estático,
    // e o reset diário fazia lista mensal "desmarcar sozinha". Caso Rose 09/06.
    const anchor = cycleAnchor(list, ymd)

    // LEITURA PURA: lê a completion do ciclo SE existir (maybeSingle). Não cria.
    const { data: comp, error: e2 } = await supabase
      .from('personal_checklist_completions')
      .select('id, personal_checklist_item_completions ( item_id, is_checked )')
      .eq('checklist_id', list.id)
      .eq('user_id', collabId)
      .eq('reference_date', anchor)
      .maybeSingle()
    if (e2) throw e2

    const checkedMap = new Map<string, boolean>(
      ((comp as any)?.personal_checklist_item_completions ?? []).map(
        (c: any) => [c.item_id as string, !!c.is_checked] as [string, boolean],
      ),
    )
    out.push({
      ...list,
      today_completion_id: (comp as any)?.id ?? null,
      cycle_anchor: anchor,
      personal_checklist_items: (list.personal_checklist_items ?? []).map((it) => ({
        ...it,
        is_done: checkedMap.get(it.id) ?? false, // sem completion → false (reset do ciclo)
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
    const checkedMap = new Map<string, boolean>(
      (c.personal_checklist_item_completions ?? []).map(
        (x: any) => [x.item_id as string, !!x.is_checked] as [string, boolean],
      ),
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
