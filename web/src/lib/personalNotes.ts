// web/src/lib/personalNotes.ts — espelho do módulo de anotações do grupo para o
// PESSOAL (tabela notes). Reusa os puros de groupNotes.ts (índice/resolvers/templates);
// IO próprio: tipos custom por dono (note_types) + reveal dono-checked. Senhas: trigger
// cifra em repouso; só o dono revela (reveal_personal_note_secret).
import { supabase } from './supabase';
import { slugifyType, type NoteField } from './groupNotes';

// Re-exporta os agnósticos pros componentes/telas pessoais (mesmo comportamento do grupo).
export {
  NOTE_TYPE_META, NOTE_TYPES, TYPE_DEFAULTS, NOTE_COLORS, NOTE_ICONS, TEMPLATES,
  buildTypeIndex, typeLabel, templateForType, resolveColor, resolveIcon, renumber,
  bodyToHtml, isEncrypted, filterNotes, notesWithSecrets, typesWithCount,
} from './groupNotes';
export type { NoteType, FieldKind, NoteField, TypeMeta, TypeIndex } from './groupNotes';

// HTML do corpo → texto multi-linha (pro "Virar tarefas" via splitNoteLines).
export function htmlToLines(html: string): string {
  return String(html || '')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\n{2,}/g, '\n').trim();
}

// Tipo de ficha customizado POR USUÁRIO (tabela note_types).
export interface PersonalNoteType {
  id: string; collaborator_id: string; key: string; label: string;
  color: string | null; icon: string | null; fields: NoteField[];
}

export async function loadNoteTypes(collaboratorId: string): Promise<PersonalNoteType[]> {
  const { data, error } = await supabase.from('note_types').select('*')
    .eq('collaborator_id', collaboratorId).order('label', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, fields: Array.isArray(t.fields) ? t.fields : [] })) as PersonalNoteType[];
}
export async function upsertNoteType(collaboratorId: string, t: Partial<PersonalNoteType> & { id?: string }): Promise<PersonalNoteType> {
  const payload: Record<string, unknown> = {
    collaborator_id: collaboratorId, key: t.key || slugifyType(t.label || ''),
    label: (t.label || '').trim() || 'Tipo', color: t.color ?? null, icon: t.icon ?? null, fields: t.fields || [],
  };
  if (t.id) payload.id = t.id;
  const { data, error } = await supabase.from('note_types').upsert(payload).select('*').single();
  if (error) throw error;
  const row = data as PersonalNoteType;
  return { ...row, fields: Array.isArray(row.fields) ? row.fields : [] };
}
export async function deleteNoteType(id: string): Promise<void> {
  const { error } = await supabase.from('note_types').delete().eq('id', id);
  if (error) throw error;
}

// Reorder (sort_order inteiro por ficha) — updates individuais (anti-reshuffle).
export async function reorderNotes(updates: Array<{ id: string; sort_order: number }>): Promise<void> {
  const results = await Promise.all(updates.map((u) => supabase.from('notes').update({ sort_order: u.sort_order }).eq('id', u.id)));
  const err = results.find((r) => r.error);
  if (err?.error) throw err.error;
}

// Revela um campo secret via RPC dono-checked (decifra server-side; numa nota
// compartilhada só o DONO decifra — o destinatário vê •••• ).
export async function revealPersonalNoteSecret(noteId: string, fieldIndex: number): Promise<string> {
  const { data, error } = await supabase.rpc('reveal_personal_note_secret', { p_note_id: noteId, p_field_index: fieldIndex });
  if (error) throw error;
  return (data as string) ?? '';
}
