import { supabase } from './supabase';

export interface PfCategoryRow {
  id: string;
  slug: string;
  label: string;
  emoji: string;
  color: string;
  type: 'expense' | 'income';
  sort_order: number;
}

// Lê as categorias ativas (defaults + custom do usuário via RLS). Ordenadas por
// tipo e sort_order pra o picker exibir agrupado.
export async function listCategories(): Promise<PfCategoryRow[]> {
  const { data, error } = await supabase
    .from('pf_categories')
    .select('id, slug, label, emoji, color, type, sort_order')
    .eq('is_active', true)
    .order('type', { ascending: true })
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data as PfCategoryRow[]) ?? [];
}
