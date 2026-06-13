import { supabase } from './supabase';

export type NoteType = 'acesso' | 'cnpj' | 'conta' | 'reuniao' | 'livre';
export type FieldKind = 'text' | 'url' | 'password';

export interface NoteField { label: string; value: string; kind?: FieldKind; secret?: boolean }

export interface GroupNote {
  id: string; group_id: string; type: NoteType; category: string; tags: string[];
  title: string; body: string; fields: NoteField[]; pinned: boolean;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}

// Metadados por tipo: rótulo curto + ícone (nome Lucide, resolvido no componente) + ordem dos chips.
export const NOTE_TYPE_META: Record<NoteType, { label: string; icon: string }> = {
  acesso: { label: 'Acesso', icon: 'KeyRound' },
  cnpj: { label: 'CNPJ', icon: 'Building2' },
  conta: { label: 'Conta', icon: 'Banknote' },
  reuniao: { label: 'Reunião', icon: 'NotebookPen' },
  livre: { label: 'Livre', icon: 'FileText' },
};
export const NOTE_TYPES: NoteType[] = ['acesso', 'cnpj', 'conta', 'reuniao', 'livre'];

// Template de campos por tipo — pré-semeia os rótulos certos ao criar uma ficha nova.
export const TEMPLATES: Record<NoteType, NoteField[]> = {
  acesso: [
    { label: 'Login', value: '', kind: 'text' },
    { label: 'Senha', value: '', kind: 'password', secret: true },
    { label: 'URL', value: '', kind: 'url' },
    { label: 'Obs', value: '', kind: 'text' },
  ],
  cnpj: [
    { label: 'Razão social', value: '', kind: 'text' },
    { label: 'CNPJ', value: '', kind: 'text' },
    { label: 'Inscrição estadual', value: '', kind: 'text' },
    { label: 'Obs', value: '', kind: 'text' },
  ],
  conta: [
    { label: 'Vencimento', value: '', kind: 'text' },
    { label: 'Valor', value: '', kind: 'text' },
    { label: 'Banco/Conta', value: '', kind: 'text' },
    { label: 'Status', value: '', kind: 'text' },
  ],
  reuniao: [
    { label: 'Data', value: '', kind: 'text' },
    { label: 'Participantes', value: '', kind: 'text' },
    { label: 'Decisões', value: '', kind: 'text' },
  ],
  livre: [],
};

export function templateFor(type: NoteType): NoteField[] {
  return TEMPLATES[type].map((f) => ({ ...f }));
}

// Valor secundário mostrado no card da lista (primeiro campo não-secreto com valor).
export function cardSubtitle(n: GroupNote): string {
  const f = (n.fields || []).find((x) => !x.secret && x.value);
  return f ? f.value : (n.body || '').replace(/\s+/g, ' ').trim();
}

export function filterNotes(notes: GroupNote[], f: { type?: NoteType; tag?: string; query?: string }): GroupNote[] {
  const q = (f.query || '').trim().toLowerCase();
  return notes.filter((n) => {
    if (f.type && n.type !== f.type) return false;
    if (f.tag && !n.tags.includes(f.tag)) return false;
    if (q) {
      const hay = `${n.title}\n${n.body}\n${(n.fields || []).map((x) => `${x.label} ${x.secret ? '' : x.value}`).join('\n')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function typesWithCount(notes: GroupNote[]): Array<{ type: NoteType; count: number }> {
  return NOTE_TYPES.map((type) => ({ type, count: notes.filter((n) => n.type === type).length })).filter((t) => t.count > 0);
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
  return (data ?? []).map((n) => ({ ...n, fields: Array.isArray(n.fields) ? n.fields : [] })) as GroupNote[];
}
export async function upsertGroupNote(groupId: string, updatedBy: string, note: Partial<GroupNote> & { id?: string }): Promise<string> {
  const payload: Record<string, unknown> = {
    group_id: groupId, title: (note.title || '').trim() || 'Sem título',
    type: note.type || 'livre', category: (note.category || 'Geral').trim(),
    tags: note.tags || [], fields: note.fields || [], body: note.body || '',
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
