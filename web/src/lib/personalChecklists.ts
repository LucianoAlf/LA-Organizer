// web/src/lib/personalChecklists.ts
// Sprint 22.38 — fetch/mutation helpers para personal_checklists.
// RLS owner-only no banco; aqui usamos sempre o supabase user-jwt client.
import { supabase } from './supabase'
import type { PersonalChecklist, PersonalListContext, PersonalListType } from '../types'

export async function fetchPersonalChecklists(
  ownerId: string,
  context: PersonalListContext = 'personal',
): Promise<PersonalChecklist[]> {
  const { data, error } = await supabase
    .from('personal_checklists')
    .select('*, personal_checklist_items (*)')
    .eq('owner_collab_id', ownerId)
    .eq('context', context)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PersonalChecklist[]
}

export async function createPersonalChecklist(input: {
  ownerId: string
  name: string
  listType: PersonalListType
  context: PersonalListContext
  initialItems: string[]
}): Promise<PersonalChecklist> {
  const { data: list, error: e1 } = await supabase
    .from('personal_checklists')
    .insert({
      owner_collab_id: input.ownerId,
      name: input.name,
      list_type: input.listType,
      context: input.context,
    })
    .select('*')
    .single()
  if (e1) throw e1

  if (input.initialItems.length) {
    const items = input.initialItems.map((d, i) => ({
      list_id: list.id,
      description: d,
      sort_order: i + 1,
    }))
    const { error: e2 } = await supabase.from('personal_checklist_items').insert(items)
    if (e2) throw e2
  }
  return list as PersonalChecklist
}

export async function toggleItem(itemId: string, isDone: boolean) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .update({ is_done: isDone })
    .eq('id', itemId)
  if (error) throw error
}

export async function addItem(listId: string, description: string, sortOrder: number) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .insert({ list_id: listId, description, sort_order: sortOrder })
  if (error) throw error
}

export async function updateItemDescription(itemId: string, description: string) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .update({ description })
    .eq('id', itemId)
  if (error) throw error
}

export async function deleteItem(itemId: string) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .delete()
    .eq('id', itemId)
  if (error) throw error
}

export async function reorderItems(ordered: { id: string; sort_order: number }[]) {
  // Updates em paralelo. RLS garante owner-only.
  const results = await Promise.all(
    ordered.map(o =>
      supabase.from('personal_checklist_items')
        .update({ sort_order: o.sort_order })
        .eq('id', o.id)
    )
  )
  for (const r of results) if (r.error) throw r.error
}

export async function renameList(listId: string, name: string) {
  const { error } = await supabase
    .from('personal_checklists')
    .update({ name })
    .eq('id', listId)
  if (error) throw error
}

export async function changeListType(listId: string, listType: PersonalListType) {
  const { error } = await supabase
    .from('personal_checklists')
    .update({ list_type: listType })
    .eq('id', listId)
  if (error) throw error
}

export async function archiveList(listId: string) {
  const { error } = await supabase
    .from('personal_checklists')
    .update({ is_active: false })
    .eq('id', listId)
  if (error) throw error
}

/** Hard delete (cascade nos items). Usar com confirmação no UI. */
export async function deleteList(listId: string) {
  const { error } = await supabase
    .from('personal_checklists')
    .delete()
    .eq('id', listId)
  if (error) throw error
}

export async function saveItemNote(itemId: string, note: string) {
  const { error } = await supabase
    .from('personal_checklist_items')
    .update({ note: note || null })
    .eq('id', itemId)
  if (error) throw error
}
