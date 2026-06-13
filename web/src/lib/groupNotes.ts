import { supabase } from './supabase';

export interface GroupNote {
  id: string; group_id: string; category: string; tags: string[];
  title: string; body: string; pinned: boolean;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}

export function filterNotes(notes: GroupNote[], f: { category?: string; tag?: string; query?: string }): GroupNote[] {
  const q = (f.query || '').trim().toLowerCase();
  return notes.filter((n) => {
    if (f.category && n.category !== f.category) return false;
    if (f.tag && !n.tags.includes(f.tag)) return false;
    if (q && !(`${n.title}\n${n.body}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

export function categoriesWithCount(notes: GroupNote[]): Array<{ category: string; count: number }> {
  const m = new Map<string, number>();
  for (const n of notes) m.set(n.category, (m.get(n.category) || 0) + 1);
  return [...m.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
}

export function allTags(notes: GroupNote[]): string[] {
  return [...new Set(notes.flatMap((n) => n.tags))].sort();
}

export function noteExcerpt(body: string, max = 120): string {
  const plain = (body || '').replace(/[#*`>_\-]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
}

// ── I/O ──
export async function loadGroupNotes(groupId: string): Promise<GroupNote[]> {
  const { data, error } = await supabase.from('group_notes')
    .select('*').eq('group_id', groupId).order('pinned', { ascending: false }).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GroupNote[];
}
export async function upsertGroupNote(groupId: string, updatedBy: string, note: Partial<GroupNote> & { id?: string }): Promise<string> {
  const payload: Record<string, unknown> = {
    group_id: groupId, title: (note.title || '').trim() || 'Sem título',
    category: (note.category || 'Geral').trim(), tags: note.tags || [], body: note.body || '',
    pinned: note.pinned ?? false, updated_by: updatedBy, updated_at: new Date().toISOString(),
  };
  if (note.id) payload.id = note.id; else payload.created_by = updatedBy;
  const { data, error } = await supabase.from('group_notes').upsert(payload).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
export async function deleteGroupNote(id: string): Promise<void> {
  const { error } = await supabase.from('group_notes').delete().eq('id', id);
  if (error) throw error;
}
export async function togglePin(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('group_notes').update({ pinned }).eq('id', id);
  if (error) throw error;
}
