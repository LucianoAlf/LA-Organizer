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

// ── Próximo disparo (rótulo pra UI) ───────────────────────────────────────────
const WEEKDAY_PT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']; // JS getDay: 0=dom

// "Agora" com os CAMPOS no fuso de São Paulo (pra cálculo de dia/hora, não instante exato).
function spNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function fmtNextRun(d: Date, now: Date): string {
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dm = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((b - a) / 86400000);
  if (diff === 0) return `hoje · ${hhmm}`;
  if (diff === 1) return `amanhã · ${hhmm}`;
  return `${WEEKDAY_PT[d.getDay()]}, ${dm} · ${hhmm}`;
}

// Texto do próximo disparo de um setting habilitado (BRT). null se desligado/sem agenda.
// `now` injetável pra teste. Casa a mesma regra do motor (group-reports.matchSchedule).
export function nextRunLabel(s: GroupNotificationSetting, now: Date = spNow()): string | null {
  if (!s.enabled) return null;
  const [hh, mm] = (s.time_local || '08:00').split(':').map(Number);
  for (let i = 0; i < 62; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm, 0, 0);
    if (d.getTime() < now.getTime()) continue; // horário de hoje já passou
    if (s.preset === 'monthly') {
      if (s.day_of_month != null && d.getDate() === s.day_of_month) return fmtNextRun(d, now);
    } else {
      const iso = d.getDay() === 0 ? 7 : d.getDay();
      if ((s.weekdays || []).includes(iso)) return fmtNextRun(d, now);
    }
  }
  return null;
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

// "Pré-visualizar" (#3): monta o relatório do preset SÓ pra ver — não dispara pro grupo.
// Chama /internal/group-report-preview (read-only no backend), mesmo padrão do formatNote.ts.
const TOM_BASE = import.meta.env.VITE_TOM_API_BASE || '';
const INTERNAL_SECRET = import.meta.env.VITE_INTERNAL_API_SECRET || '';

export type ReportPreview =
  | { ok: true; html: string; isEmpty: boolean; heading: string }
  | { ok: false; reason: string };

export async function previewGroupReport(groupId: string, preset: Preset): Promise<ReportPreview> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const res = await fetch(`${TOM_BASE}/internal/group-report-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ group_id: groupId, preset }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const data = await res.json();
    return data?.ok
      ? { ok: true, html: String(data.html || ''), isEmpty: !!data.isEmpty, heading: String(data.heading || '') }
      : { ok: false, reason: String(data?.error || 'unknown') };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
