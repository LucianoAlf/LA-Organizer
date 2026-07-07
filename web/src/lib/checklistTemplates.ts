// Modelos de checklist compartilhados no time (demanda Jonathan ADM 06/07).
// Tabela checklist_templates — spec docs/superpowers/specs/2026-07-06-checklist-templates-design.md
// canManageTemplate espelha EXATAMENTE a RLS (criador OU coordinator/director) — nunca
// divergir UI de política (lição DELEGATE-EDIT-COORD-GATE-TRAP).
import { supabase } from './supabase';

export interface ChecklistTemplate { id: string; name: string; items: string[]; created_by: string }

export function applyTemplate(draft: string[], tplItems: string[]): string[] {
  const have = new Set(draft.map((s) => s.trim()));
  const add = tplItems.map((s) => s.trim()).filter((s) => s && !have.has(s));
  return [...draft, ...add];
}

export function normalizeTemplateName(raw: string): string | null {
  const name = (raw || '').trim();
  return name.length >= 2 && name.length <= 80 ? name : null;
}

export function canManageTemplate(
  t: Pick<ChecklistTemplate, 'created_by'>, meuId: string | undefined, role: string | undefined,
): boolean {
  if (!meuId) return false;
  return t.created_by === meuId || role === 'coordinator' || role === 'director';
}

export async function listTemplates(): Promise<ChecklistTemplate[]> {
  const { data, error } = await supabase
    .from('checklist_templates').select('id, name, items, created_by').order('name');
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, items: Array.isArray(t.items) ? t.items : [] })) as ChecklistTemplate[];
}

export async function createTemplate(name: string, items: string[], collabId: string): Promise<ChecklistTemplate> {
  const { data, error } = await supabase
    .from('checklist_templates')
    .insert({ name, items, created_by: collabId })
    .select('id, name, items, created_by').single();
  if (error) throw error;
  return data as ChecklistTemplate;
}

export async function updateTemplate(id: string, patch: { name?: string; items?: string[] }): Promise<void> {
  const { error } = await supabase
    .from('checklist_templates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('checklist_templates').delete().eq('id', id);
  if (error) throw error;
}

// Erro amigável pro índice único de nome (Postgres 23505 unique_violation).
export const isDupName = (e: unknown): boolean =>
  typeof (e as { code?: string })?.code === 'string' && (e as { code: string }).code === '23505';
