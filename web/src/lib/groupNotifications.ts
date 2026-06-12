import { supabase } from './supabase';

export type Preset = 'daily_morning' | 'weekly' | 'monthly' | 'overdue';

export interface GroupNotificationSetting {
  preset: Preset;
  enabled: boolean;
  weekdays: number[];        // 1=seg .. 7=dom
  day_of_month: number | null;
  time_local: string;        // 'HH:MM'
}

export interface PresetMeta {
  preset: Preset;
  emoji: string;
  label: string;
  desc: string;
  schedule: 'weekdays' | 'single_weekday' | 'day_of_month';
}

export const PRESETS: PresetMeta[] = [
  { preset: 'daily_morning', emoji: '☀️', label: 'Bom dia diário', desc: '"Hoje o grupo tem…"', schedule: 'weekdays' },
  { preset: 'weekly', emoji: '📅', label: 'Resumo semanal', desc: 'Panorama da semana', schedule: 'single_weekday' },
  { preset: 'monthly', emoji: '🗓️', label: 'Resumo mensal', desc: 'Panorama do mês', schedule: 'day_of_month' },
  { preset: 'overdue', emoji: '⏰', label: 'Cobrança de atrasadas', desc: 'Só quando há tarefa vencida', schedule: 'weekdays' },
];

const DEFAULTS: Record<Preset, GroupNotificationSetting> = {
  daily_morning: { preset: 'daily_morning', enabled: true, weekdays: [1, 2, 3, 4, 5], day_of_month: null, time_local: '08:00' },
  weekly:        { preset: 'weekly', enabled: true, weekdays: [1], day_of_month: null, time_local: '08:00' },
  monthly:       { preset: 'monthly', enabled: true, weekdays: [], day_of_month: 1, time_local: '08:00' },
  overdue:       { preset: 'overdue', enabled: true, weekdays: [1, 2, 3, 4, 5], day_of_month: null, time_local: '09:00' },
};

export function defaultSetting(preset: Preset): GroupNotificationSetting {
  return { ...DEFAULTS[preset] };
}

function normTime(t: string): string {
  const [h, m] = String(t || '08:00').split(':');
  const hh = String(Math.min(23, Math.max(0, Number(h) || 0))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, Number(m) || 0))).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function validateSetting(s: GroupNotificationSetting): GroupNotificationSetting {
  let weekdays = Array.from(new Set((s.weekdays || []).filter((d) => d >= 1 && d <= 7))).sort((a, b) => a - b);
  if (s.preset === 'weekly' && weekdays.length > 1) weekdays = [weekdays[0]];
  let day_of_month = s.day_of_month;
  if (day_of_month != null) day_of_month = Math.min(28, Math.max(1, day_of_month));
  return { ...s, weekdays, day_of_month, time_local: normTime(s.time_local) };
}

// I/O — RLS garante que só membros leem/editam.
export async function loadGroupNotifications(groupId: string): Promise<GroupNotificationSetting[]> {
  const { data, error } = await supabase
    .from('group_notification_settings')
    .select('preset, enabled, weekdays, day_of_month, time_local')
    .eq('group_id', groupId);
  if (error) throw error;
  return (data ?? []) as GroupNotificationSetting[];
}

export async function upsertGroupNotification(groupId: string, s: GroupNotificationSetting): Promise<void> {
  const v = validateSetting(s);
  const { error } = await supabase
    .from('group_notification_settings')
    .upsert({ group_id: groupId, ...v, updated_at: new Date().toISOString() }, { onConflict: 'group_id,preset' });
  if (error) throw error;
}
