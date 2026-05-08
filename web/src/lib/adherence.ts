// web/src/lib/adherence.ts
// Sprint 22.37 — queries + helpers pra tela /mais/aderencia-checklists.
// Usa RPCs server-side (get_adherence_by_collab, get_adherence_by_template)
// pra agregar com 1 round-trip respeitando RLS.

import { supabase } from './supabase'
import { todaySP, ymdAddDays } from '../utils/date'
import type {
  AdherenceByCollab,
  AdherenceByTemplate,
  AdherenceObservation,
  AdherenceWindow,
} from '../types'

/** Resolve uma janela em [start, end] no formato YYYY-MM-DD (BRT). */
export function getDateRange(window: AdherenceWindow): { start: string; end: string } {
  const today = todaySP()
  if (window === 'today') {
    return { start: today, end: today }
  }
  if (window === 'week') {
    // Segunda → hoje
    const d = new Date(today + 'T15:00:00.000Z') // meio-dia BRT
    const dow = d.getUTCDay() // 0=dom, 1=seg, ..., 6=sáb
    const diffToMonday = dow === 0 ? -6 : 1 - dow
    const monday = ymdAddDays(today, diffToMonday)
    return { start: monday, end: today }
  }
  // month
  const [y, m] = today.split('-')
  const startOfMonth = `${y}-${m}-01`
  return { start: startOfMonth, end: today }
}

export async function fetchAdherenceByCollab(
  start: string,
  end: string,
  unit: string | null,
): Promise<AdherenceByCollab[]> {
  const { data, error } = await supabase.rpc('get_adherence_by_collab', {
    p_start_date: start,
    p_end_date: end,
    p_unit_filter: unit,
  })
  if (error) throw error
  return (data ?? []) as AdherenceByCollab[]
}

export async function fetchAdherenceByTemplate(
  collabId: string,
  start: string,
  end: string,
): Promise<AdherenceByTemplate[]> {
  const { data, error } = await supabase.rpc('get_adherence_by_template', {
    p_collab_id: collabId,
    p_start_date: start,
    p_end_date: end,
  })
  if (error) throw error
  return (data ?? []) as AdherenceByTemplate[]
}

export async function fetchAdherenceObservations(
  collabId: string,
  start: string,
  end: string,
  limit = 20,
): Promise<AdherenceObservation[]> {
  // Items do template (com nota)
  const { data: tplData, error: tplErr } = await supabase
    .from('op_checklist_item_completions')
    .select(`
      notes,
      op_checklist_items(description),
      op_checklist_completions!inner(reference_date, op_checklists(name))
    `)
    .eq('op_checklist_completions.collaborator_id', collabId)
    .gte('op_checklist_completions.reference_date', start)
    .lte('op_checklist_completions.reference_date', end)
    .not('notes', 'is', null)
    .limit(limit)
  if (tplErr) throw tplErr

  // Items ad-hoc (com nota)
  const { data: extraData, error: extraErr } = await supabase
    .from('op_checklist_completion_extra_items')
    .select(`
      notes, description,
      op_checklist_completions!inner(reference_date, op_checklists(name))
    `)
    .eq('op_checklist_completions.collaborator_id', collabId)
    .gte('op_checklist_completions.reference_date', start)
    .lte('op_checklist_completions.reference_date', end)
    .not('notes', 'is', null)
    .limit(limit)
  if (extraErr) throw extraErr

  type RawCompletion =
    | { reference_date: string; op_checklists: { name: string } | { name: string }[] | null }
    | { reference_date: string; op_checklists: { name: string } | { name: string }[] | null }[]
    | null

  function unwrapCompletion(c: RawCompletion): { reference_date: string; tplName: string } {
    const obj = Array.isArray(c) ? c[0] : c
    if (!obj) return { reference_date: '', tplName: '' }
    const tpl = Array.isArray(obj.op_checklists) ? obj.op_checklists[0] : obj.op_checklists
    return { reference_date: obj.reference_date, tplName: tpl?.name ?? '' }
  }

  function unwrapItem(
    i: { description: string } | { description: string }[] | null | undefined,
  ): string | null {
    if (!i) return null
    const obj = Array.isArray(i) ? i[0] : i
    return obj?.description ?? null
  }

  const tplMapped: AdherenceObservation[] = (tplData ?? []).map((row) => {
    const c = unwrapCompletion(row.op_checklist_completions as RawCompletion)
    return {
      notes: row.notes as string,
      reference_date: c.reference_date,
      template_name: c.tplName,
      item_description: unwrapItem(
        row.op_checklist_items as { description: string } | { description: string }[] | null,
      ),
    }
  })

  const extraMapped: AdherenceObservation[] = (extraData ?? []).map((row) => {
    const c = unwrapCompletion(row.op_checklist_completions as RawCompletion)
    return {
      notes: row.notes as string,
      reference_date: c.reference_date,
      template_name: c.tplName,
      item_description: row.description as string,
    }
  })

  return [...tplMapped, ...extraMapped]
    .sort((a, b) => b.reference_date.localeCompare(a.reference_date))
    .slice(0, limit)
}

/** Tone helper baseado em PRD §4. */
export function adherenceTone(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 90) return 'success'
  if (pct >= 70) return 'warning'
  return 'danger'
}

/** Cor do border-left do card. */
export function adherenceBorder(pct: number): string {
  const tone = adherenceTone(pct)
  if (tone === 'success') return 'border-success'
  if (tone === 'warning') return 'border-warning'
  return 'border-danger'
}

/** Emoji semáforo. */
export function adherenceEmoji(pct: number): string {
  const tone = adherenceTone(pct)
  if (tone === 'success') return '🟢'
  if (tone === 'warning') return '🟡'
  return '🔴'
}
