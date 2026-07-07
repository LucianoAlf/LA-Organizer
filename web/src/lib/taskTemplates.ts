// Modelos de tarefa PESSOAIS (demanda Jonathan ADM 07/07).
// Spec: docs/superpowers/specs/2026-07-07-task-templates-design.md
// Payload = snapshot jsonb do formulário do QuickCreateSheet, filtrado por
// whitelist POR KIND — o guardrail que impede data/recorrência de entrar no
// modelo. Privado por dono: a RLS de task_templates só enxerga o criador
// (diferente de checklist_templates, que é do time).
import { supabase } from './supabase';

export { normalizeTemplateName, isDupName } from './checklistTemplates';

export type TemplateKind = 'task' | 'event' | 'delegated' | 'group';

export interface TaskTemplate {
  id: string;
  name: string;
  kind: TemplateKind;
  payload: Record<string, unknown>;
  created_by: string;
}

export const KIND_LABEL: Record<TemplateKind, string> = {
  task: 'Tarefa', event: 'Compromisso', delegated: 'Delegar', group: 'Grupo',
};

const KEYS: Record<TemplateKind, readonly string[]> = {
  task: ['title', 'description', 'ctx', 'group_mode', 'group_id', 'time', 'reminders', 'quadrant', 'checklist'],
  delegated: ['title', 'description', 'ctx', 'delegate_to', 'cc_ids', 'time', 'reminders', 'quadrant', 'checklist'],
  event: ['title', 'description', 'category_id', 'start_time', 'end_time', 'modality',
    'location_text', 'meeting_url', 'quadrant', 'reminders', 'participant_ids'],
  group: ['title', 'description', 'group_id', 'monthly', 'due_day', 'children'],
};

export function payloadFromSnapshot(kind: TemplateKind, snap: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of KEYS[kind]) {
    const v = snap[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

export function isSnapshotEmpty(payload: Record<string, unknown>): boolean {
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (title) return false;
  const checklist = Array.isArray(payload.checklist) ? payload.checklist : [];
  const children = Array.isArray(payload.children) ? payload.children : [];
  return checklist.length === 0 && children.length === 0;
}

// Aplicação: ids que envelheceram (delegado que saiu do time, categoria/grupo
// apagados) são LIMPOS com aviso — aplicar modelo nunca pode quebrar o form.
export function formPatchFromPayload(
  kind: TemplateKind,
  payload: Record<string, unknown>,
  refs: { collabIds: Set<string>; categoryIds: Set<string>; groupIds: Set<string> },
): { patch: Record<string, unknown>; warnings: string[] } {
  // Re-whitelist: payload salvo por versão antiga (ou campo aposentado) cai fora aqui.
  const patch = payloadFromSnapshot(kind, payload);
  const warnings: string[] = [];
  if (typeof patch.delegate_to === 'string' && !refs.collabIds.has(patch.delegate_to)) {
    delete patch.delegate_to;
    warnings.push('O responsável salvo no modelo saiu do time — escolhe outro.');
  }
  for (const key of ['cc_ids', 'participant_ids'] as const) {
    const ids = patch[key];
    if (Array.isArray(ids)) {
      const ok = (ids as string[]).filter((id) => refs.collabIds.has(id));
      if (ok.length < ids.length) warnings.push('Removi do modelo pessoas que saíram do time.');
      patch[key] = ok;
    }
  }
  if (typeof patch.category_id === 'string' && !refs.categoryIds.has(patch.category_id)) {
    delete patch.category_id;
    warnings.push('A categoria do modelo não existe mais.');
  }
  if (typeof patch.group_id === 'string' && !refs.groupIds.has(patch.group_id)) {
    delete patch.group_id;
    patch.group_mode = false;
    warnings.push('O grupo do modelo não existe mais — voltei o responsável pra você.');
  }
  return { patch, warnings };
}

export async function listMyTemplates(): Promise<TaskTemplate[]> {
  const { data, error } = await supabase
    .from('task_templates').select('id, name, kind, payload, created_by').order('name');
  if (error) throw error;
  return (data ?? []).map((t) => ({
    ...t,
    payload: t.payload && typeof t.payload === 'object' ? t.payload : {},
  })) as TaskTemplate[];
}

export async function createTaskTemplate(
  name: string, kind: TemplateKind, payload: Record<string, unknown>, collabId: string,
): Promise<void> {
  const { error } = await supabase.from('task_templates').insert({ name, kind, payload, created_by: collabId });
  if (error) throw error;
}

export async function updateTaskTemplate(
  id: string, patch: { name?: string; payload?: Record<string, unknown> },
): Promise<void> {
  const { error } = await supabase.from('task_templates')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteTaskTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('task_templates').delete().eq('id', id);
  if (error) throw error;
}
