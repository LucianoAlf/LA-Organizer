import { supabase } from './supabase';

export type NoteType = 'acesso' | 'cnpj' | 'conta' | 'reuniao' | 'livre';
export type FieldKind = 'text' | 'url' | 'password';

export interface NoteField { label: string; value: string; kind?: FieldKind; secret?: boolean }

export interface GroupNote {
  id: string; group_id: string; type: NoteType; category: string; tags: string[];
  title: string; body: string; fields: NoteField[]; pinned: boolean;
  sort_order: number; color: string | null; icon: string | null;
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

// Aparência padrão por tipo (cor de destaque + ícone). Ícone derivado do NOTE_TYPE_META (DRY).
export const TYPE_DEFAULTS: Record<NoteType, { color: string; icon: string }> = {
  acesso: { color: '#185FA5', icon: NOTE_TYPE_META.acesso.icon },   // azul
  cnpj: { color: '#1D9E75', icon: NOTE_TYPE_META.cnpj.icon },       // esmeralda
  conta: { color: '#BA7517', icon: NOTE_TYPE_META.conta.icon },     // mostarda
  reuniao: { color: '#993556', icon: NOTE_TYPE_META.reuniao.icon }, // vinho
  livre: { color: '#5F5E5A', icon: NOTE_TYPE_META.livre.icon },     // cinza
};
// Paleta curada — 13 cores distintas cobrindo o espectro (DS ramps, stops vívidos).
export const NOTE_COLORS = [
  '#E24B4A', // vermelho
  '#D85A30', // laranja
  '#EF9F27', // amarelo
  '#BA7517', // mostarda
  '#639922', // verde-limão
  '#1D9E75', // esmeralda
  '#378ADD', // azul claro
  '#185FA5', // azul
  '#7F77DD', // violeta
  '#534AB7', // roxo
  '#D4537E', // rosa
  '#993556', // vinho
  '#5F5E5A', // cinza
];
export const NOTE_ICONS = ['KeyRound', 'Building2', 'BuildingStore', 'Banknote', 'CreditCard', 'NotebookPen', 'FileText', 'IdCard', 'CalendarDays', 'Landmark', 'Receipt', 'Lock', 'Mail', 'Phone', 'MapPin', 'Star'];

// Cor/ícone efetivos: override da ficha, senão o padrão do tipo.
export const resolveColor = (n: Pick<GroupNote, 'type' | 'color'>): string => n.color ?? TYPE_DEFAULTS[n.type].color;
export const resolveIcon = (n: Pick<GroupNote, 'type' | 'icon'>): string => n.icon ?? TYPE_DEFAULTS[n.type].icon;

// Renumera uma lista (na ordem visual) → sort_order 1..N. Menor = mais acima.
export const renumber = (list: { id: string }[]): Array<{ id: string; sort_order: number }> =>
  list.map((n, i) => ({ id: n.id, sort_order: i + 1 }));

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
    .select('*').eq('group_id', groupId)
    .order('pinned', { ascending: false }).order('sort_order', { ascending: true }).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((n) => ({
    ...n, fields: Array.isArray(n.fields) ? n.fields : [],
    sort_order: n.sort_order ?? 0, color: n.color ?? null, icon: n.icon ?? null,
  })) as GroupNote[];
}
export async function upsertGroupNote(groupId: string, updatedBy: string, note: Partial<GroupNote> & { id?: string }): Promise<string> {
  const payload: Record<string, unknown> = {
    group_id: groupId, title: (note.title || '').trim() || 'Sem título',
    type: note.type || 'livre', category: (note.category || 'Geral').trim(),
    tags: note.tags || [], fields: note.fields || [], body: note.body || '',
    color: note.color ?? null, icon: note.icon ?? null,
    pinned: note.pinned ?? false, updated_by: updatedBy, updated_at: new Date().toISOString(),
  };
  if (note.id) payload.id = note.id; else payload.created_by = updatedBy;
  const { data, error } = await supabase.from('group_notes').upsert(payload).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

// Persiste a nova ordem (sort_order inteiro por ficha). Updates individuais (anti-reshuffle).
export async function reorderGroupNotes(updates: Array<{ id: string; sort_order: number }>): Promise<void> {
  const results = await Promise.all(updates.map((u) => supabase.from('group_notes').update({ sort_order: u.sort_order }).eq('id', u.id)));
  const err = results.find((r) => r.error);
  if (err?.error) throw err.error;
}
export async function deleteGroupNote(id: string): Promise<void> {
  const { error } = await supabase.from('group_notes').delete().eq('id', id);
  if (error) throw error;
}
export async function togglePin(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('group_notes').update({ pinned }).eq('id', id);
  if (error) throw error;
}
