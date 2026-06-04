import { supabase } from './supabase';

export interface PfCategoryRow {
  id: string; slug: string; label: string; emoji: string; color: string;
  type: 'expense' | 'income'; sort_order: number; is_active: boolean; is_custom: boolean;
}

// Lê TODAS as categorias (ativas e inativas) do usuário via RLS.
// Picker filtra is_active client-side; lookup precisa das inativas pra resolver labels históricos.
export async function listCategories(): Promise<PfCategoryRow[]> {
  const { data, error } = await supabase
    .from('pf_categories')
    .select('id, slug, label, emoji, color, type, sort_order, is_active, collaborator_id')
    .order('type', { ascending: true }).order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, slug: r.slug, label: r.label, emoji: r.emoji, color: r.color,
    type: r.type, sort_order: r.sort_order, is_active: r.is_active, is_custom: r.collaborator_id != null,
  }));
}

const CAT_COLORS = ['#F59E0B','#8B5CF6','#EC4899','#22C55E','#3B82F6','#EF4444','#06B6D4','#A16207','#D946EF','#0EA5E9'];

export async function createCategory(collaboratorId: string, input: { label: string; emoji: string; type: 'expense' | 'income' }) {
  const label = input.label.trim();
  if (!label) throw new Error('Dá um nome pra categoria.');
  const all = await listCategories();
  const sameType = all.filter((c) => c.type === input.type);
  if (sameType.some((c) => c.is_active && c.label.toLowerCase() === label.toLowerCase()))
    throw new Error('Já existe uma categoria com esse nome.');
  const taken = new Set(sameType.map((c) => c.slug));
  const { toSlug, uniqueSlug } = await import('./slugify');
  const slug = uniqueSlug(toSlug(label), taken);
  const color = CAT_COLORS[sameType.length % CAT_COLORS.length];
  const maxSort = sameType.reduce((m, c) => Math.max(m, c.sort_order), 0);
  const { data, error } = await supabase.from('pf_categories').insert({
    collaborator_id: collaboratorId, slug, label, emoji: input.emoji || '🏷️', color,
    type: input.type, is_default: false, sort_order: maxSort + 1, is_active: true,
  }).select().single();
  if (error) throw error;
  return data as { slug: string };
}

export async function deactivateCategory(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_categories')
    .update({ is_active: false }).eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
