// Shared types used across screens. These mirror Supabase columns; full schema
// lives in docs/03-esquema-banco-dados-la-organizer.md and src/supabase/client (backend).
// PWA reads only — never duplicates business logic (see PRD §5.2).

export type Role = 'collaborator' | 'leader' | 'coordinator' | 'director';

export interface Collaborator {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  function_title: string | null;
  unit: string | null;
  is_active: boolean;
  onboarding_completed: boolean;
}

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'overdue' | 'delegated' | 'awaiting_confirmation';

export type EventSector = 'logistica' | 'tecnica' | 'pedagogico' | 'comunicacao' | 'producao';

export const SECTOR_LABELS: Record<EventSector, string> = {
  logistica: 'Logística',
  tecnica: 'Técnica',
  pedagogico: 'Pedagógico',
  comunicacao: 'Comunicação',
  producao: 'Produção',
};

export const SECTORS: EventSector[] = ['logistica', 'tecnica', 'pedagogico', 'comunicacao', 'producao'];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  done: 'Concluída',
  cancelled: 'Cancelada',
  overdue: 'Atrasada',
  delegated: 'Delegada',
  awaiting_confirmation: 'Aguardando confirmação',
};

export type TaskContext = 'personal' | 'work';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type Quadrant = 'q1' | 'q2' | 'q3' | 'q4' | null;

// Sprint 3 — informational categorization shared by tasks + events.
// NOT a security axis. Privacy lives in `context`. See docs/MODELO-EVENTS-VS-TASKS.md.
//
// Sprint 22.26 — events migraram pra `event_categories` (tabela dinamica). Aqui
// fica so o slug enum legado pra TASKS (que continuam usando string fixa). Pra
// events, ver EventCategory abaixo.
export type Category =
  | 'la_music'
  | 'mentoria'
  | 'aula_particular'
  | 'outra_escola'
  | 'estudio'
  | 'pessoal';

export const CATEGORY_LABELS: Record<Category, string> = {
  la_music: 'LA Music',
  mentoria: 'Mentoria',
  aula_particular: 'Aula particular',
  outra_escola: 'Outra escola',
  estudio: 'Estúdio',
  pessoal: 'Pessoal',
};

// Sprint 22.26 — categoria de evento dinamica. Globais (collaborator_id NULL,
// is_system=true) sao las work categories. Pessoais sao por user (academia,
// medico, jiu-jitsu, etc.).
export interface EventCategory {
  id: string;
  collaborator_id: string | null;  // NULL = global
  slug: string;
  label: string;
  context: TaskContext;            // work | personal
  icon: string | null;
  is_system: boolean;
  sort_order: number;
}

// Default mapping at creation: pessoal → personal; demais → work.
// User can override only via UI (Sprint 4+ feature). Sprint 3 keeps simple.
// Sprint 22.26 — usado so por tasks; events agora derivam de category.context.
export function defaultContextForCategory(c: Category): TaskContext {
  return c === 'pessoal' ? 'personal' : 'work';
}

// Sprint 12 Bloco D — Categoria de execução decidida pelo motor de priorização (TOM skill priorizacao-inteligente).
// NULL = task legada / criada antes do feature OU fluxo manual sem classificação.
export type ActionType = 'now' | 'task' | 'call' | 'meeting' | 'delegate' | 'project';

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  now: 'Resolve agora',
  task: 'Tarefa',
  call: 'Ligação',
  meeting: 'Reunião',
  delegate: 'Delegar',
  project: 'Projeto',
};

// Emoji + cor por categoria. Cor vai pro Tailwind (text-/bg-/border-).
// Sem emoji "redundante" com ⏰/🔴 — esses são marcadores de URGÊNCIA, action_type é CATEGORIA.
export const ACTION_TYPE_VISUAL: Record<ActionType, { icon: string; tone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' }> = {
  now:      { icon: '⚡', tone: 'danger' },     // urgência alta
  task:     { icon: '📋', tone: 'neutral' },    // padrão
  call:     { icon: '📞', tone: 'brand' },      // ligação destacada
  meeting:  { icon: '🤝', tone: 'warning' },    // reunião pede preparo
  delegate: { icon: '🫱', tone: 'success' },    // delegado / fora da mão
  project:  { icon: '🗂️', tone: 'brand' },      // projeto
};

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  context: TaskContext;
  priority: TaskPriority;
  category?: Category | null;
  action_type?: ActionType | null;
  due_date: string | null;
  scheduled_date?: string | null;
  remind_at: string | null;
  eisenhower_quadrant: Quadrant;
  project_id: string | null;
  assigned_to: string;
  created_by: string;
  completed_at?: string | null;
  created_at?: string;
  projects?: { name: string } | null;
  // Sprint 14 Fatia 1 — campos de tasks de evento (todos opcionais)
  school_event_id?: string | null;
  event_sector?: EventSector | null;
  notes?: string | null;
  support_team?: string[] | null;
  // Sprint 22.5 — origem da task (mostra ícone se ≠ manual) + nome do assignee (delegadas)
  source?: string | null;
  assignee?: { full_name: string } | null;
}

export type EventStatus = 'scheduled' | 'done' | 'cancelled';
export type EventModality = 'online' | 'presencial' | 'hibrido';

export interface CalendarEvent {
  id: string;
  collaborator_id: string;
  title: string;
  description: string | null;
  context: TaskContext;
  // Sprint 22.26 — events.category (text slug) virou events.category_id (UUID FK
  // para event_categories). Categoria carregada via JOIN aparece em `category`.
  category_id: string;
  category?: EventCategory | null;
  start_at: string;       // ISO with TZ
  end_at: string;
  modality: EventModality;
  location_text: string | null;
  meeting_url: string | null;
  project_id: string | null;
  status: EventStatus;
  /** Sprint 22.30 — prioridade Eisenhower (1-4) opcional. NULL = sem classificar. */
  eisenhower_quadrant: number | null;
  created_by: string | null;
  source: 'manual' | 'tom' | 'imported';
  created_at: string;
  updated_at: string;
  projects?: { name: string } | null;
}

export const MODALITY_LABELS: Record<EventModality, string> = {
  online: 'Online',
  presencial: 'Presencial',
  hibrido: 'Híbrido',
};

// Sprint 8: alinhado ao CHECK do banco. 'done' nunca existiu nesta tabela
// (CHECK desde sempre usou 'completed'); 'pending_approval' adicionado em
// migration sprint8_project_wizard_approval.
export type ProjectStatus =
  | 'pending_approval'
  | 'planning'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type ProjectCategory =
  | 'pedagogical'
  | 'commercial'
  | 'administrative'
  | 'operational'
  | 'event'
  | 'infrastructure';

// Enum frontend do wizard. DB armazena como text; validação é frontend.
export type ProjectLocation = 'campo_grande' | 'recreio' | 'barra' | 'online' | 'outro';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  category: ProjectCategory;
  status: ProjectStatus;
  progress_percent: number;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
  // Sprint 8 — campos 5W2H do wizard (colunas já existiam no DB):
  justification: string | null;
  methodology: string | null;
  location: string | null;
  estimated_hours_week: number | null;
  // Sprint 8 — auditoria de aprovação (novas colunas):
  requires_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
}

// Sprint 22.22 — Time do Projeto. Membro pode ser interno (collaborator)
// OU externo (guest, prestador de servico). RLS no banco filtra o que cada um ve.
export type ProjectMemberRole = 'owner' | 'coordinator' | 'member';

export const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  owner: 'Owner',
  coordinator: 'Coordenador',
  member: 'Membro',
};

export interface ProjectMember {
  id: string;
  project_id: string;
  collaborator_id: string | null;
  role_in_project: ProjectMemberRole;
  /** Sprint 22.22j — funcao do membro NESTE projeto (texto livre). */
  function_in_project: string | null;
  guest_name: string | null;
  guest_role: string | null;
  created_at: string;
  // Join opcional com collaborators (preenchido via select)
  collaborator?: { id: string; full_name: string; function_title: string | null } | null;
}

export interface Checkpoint {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  due_date: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'cancelled';
  completed_at: string | null;
  sort_order?: number | null;
}

// ── Checklists Operacionais ──────────────────────────────────────────────────

export interface OpChecklistTemplate {
  id: string
  name: string
  function_role: string
  unit: string
  shift: string
  days_of_week: number[]
  dispatch_time: string        // "HH:MM"
  completion_threshold: number  // 0–100
  is_active: boolean
  created_by: string | null
  updated_by: string | null
  created_at?: string
  updated_at?: string
}

export interface OpChecklistItem {
  id: string
  checklist_id: string
  description: string
  sort_order: number
  is_active: boolean
  updated_by: string | null
}

export interface OpChecklistItemCompletion {
  id: string
  completion_id: string
  item_id: string
  is_checked: boolean
  channel: 'pwa' | 'whatsapp'
  late: boolean
  /** Sprint 22.35 — observação capturada pelo TOM (skill add_note) ou pelo PWA. */
  notes?: string | null
  /** Sprint 22.36 — reorder per-user. NULL = usa template default sort_order. */
  user_sort_order?: number | null
}

/** Sprint 22.36 — Item ad-hoc criado pelo colaborador na instância de checklist do dia.
 * Não polui o template — vive só nessa completion específica. */
export interface OpChecklistCompletionExtraItem {
  id: string
  completion_id: string
  description: string
  is_checked: boolean
  notes?: string | null
  sort_order: number
  user_sort_order?: number | null
  created_at: string
  created_by?: string | null
}

export interface OpChecklistCompletion {
  id: string
  collaborator_id: string
  checklist_id: string
  reference_date: string       // "YYYY-MM-DD"
  dispatched_at: string | null
  completed_at: string | null
  /** Sprint 22.36 — cobrança disparada pelo dispatcher quando janela 6h vence. */
  reminded_at?: string | null
  reminder_replied?: boolean
  escalated_at?: string | null
  // joins
  op_checklists: OpChecklistTemplate & {
    op_checklist_items: OpChecklistItem[]
  }
  op_checklist_item_completions: OpChecklistItemCompletion[]
  /** Sprint 22.36 — items ad-hoc criados pelo colab nessa instância. */
  op_checklist_completion_extra_items?: OpChecklistCompletionExtraItem[]
}

/** Returns true if the checklist window (dispatched_at + 6h) has closed */
export function isChecklistWindowClosed(dispatchedAt: string | null): boolean {
  if (!dispatchedAt) return false
  const end = new Date(new Date(dispatchedAt).getTime() + 6 * 60 * 60 * 1000)
  return new Date() > end
}

export interface OpChecklistAudit {
  id: string
  template_id: string
  action:
    | 'created' | 'updated' | 'deactivated' | 'activated'
    | 'item_added' | 'item_removed' | 'item_updated' | 'reordered'
  changed_by: string | null
  changed_at: string
  details: Record<string, unknown> | null
  collaborator?: { full_name: string }
}

/** Draft item in the template edit sheet — before DB commit */
export interface OpChecklistItemDraft {
  id?: string           // undefined = new item not yet in DB
  description: string
  sort_order: number
  is_active: boolean    // false = marked for removal
}

// ─── Sprint 13 F1 — Comunicados Internos ────────────────────────────────────

export interface AnnouncementAudience {
  all?: boolean;
  function_role?: string[];
  unidade?: string[];
  turno?: string[];
}

export interface Announcement {
  id: string;
  created_by: string;
  body: string;
  audience: AnnouncementAudience;
  status: 'pending_approval' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'rejected';
  scheduled_at: string | null;
  cancel_retraction_sent: boolean;
  reviewed_by: string | null;
  rejection_reason: string | null;
  coordinator_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementJob {
  id: string;
  announcement_id: string;
  recipient_id: string | null;
  phone: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  retry_count: number;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export function audienceLabel(audience: AnnouncementAudience): string {
  if (!audience || audience.all) return 'Todos';
  const parts: string[] = [];
  const roleMap: Record<string, string> = {
    secretary_morning: 'Secretaria manhã',
    secretary_evening: 'Secretaria tarde',
    pedagogical_assistant: 'Pedagógico',
    cleaning: 'Limpeza',
    coordinator: 'Coordenação',
    director: 'Diretoria',
  };
  const unitMap: Record<string, string> = {
    barra: 'Barra', recreio: 'Recreio', campo_grande: 'Campo Grande',
  };
  const turnoMap: Record<string, string> = {
    morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite', full: 'Integral',
  };
  if (audience.function_role?.length) {
    parts.push(audience.function_role.map(r => roleMap[r] ?? r).join(', '));
  }
  if (audience.unidade?.length) {
    parts.push(audience.unidade.map(u => unitMap[u] ?? u).join(', '));
  }
  if (audience.turno?.length) {
    parts.push(audience.turno.map(t => turnoMap[t] ?? t).join(', '));
  }
  return parts.join(' · ') || 'Todos';
}

// ─── Sprint 13 F3 — Observabilidade types & helpers ─────────────────────────

export interface AnnouncementWithMetrics extends Announcement {
  author_name: string | null;
  reviewer_name: string | null;
  jobs_total: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_cancelled: number;
  jobs_pending: number;
}

export type ApprovalAction = 'approve' | 'reject';

/**
 * Detect duplicate-risk announcements: returns the IDs of announcements that share
 * audience-overlap with another active announcement created on the same calendar day.
 */
export function detectDuplicates(items: Announcement[]): Set<string> {
  const dupSet = new Set<string>();
  const active = items.filter(a => ['pending_approval', 'scheduled', 'sending'].includes(a.status));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const sameDay = a.created_at.slice(0, 10) === b.created_at.slice(0, 10);
      if (!sameDay) continue;
      if (audienceOverlap(a.audience, b.audience)) {
        dupSet.add(a.id);
        dupSet.add(b.id);
      }
    }
  }
  return dupSet;
}

function audienceOverlap(x: AnnouncementAudience, y: AnnouncementAudience): boolean {
  if (x.all === true || y.all === true) return true;
  const inter = (a?: string[], b?: string[]) =>
    !!(a && b && a.some(v => b.includes(v)));
  if (inter(x.function_role, y.function_role)) return true;
  if (inter(x.unidade, y.unidade)) return true;
  if (inter(x.turno, y.turno)) return true;
  return false;
}

/**
 * Format "há X min/h/d" relative to now.
 */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

/**
 * Format announcement status for display.
 */
export function statusLabel(s: Announcement['status']): string {
  const map: Record<Announcement['status'], string> = {
    pending_approval: 'Aguardando aprovação',
    scheduled: 'Agendado',
    sending: 'Enviando',
    sent: 'Enviado',
    cancelled: 'Cancelado',
    rejected: 'Rejeitado',
  };
  return map[s];
}

// ─── Sprint 13 F2 — Eventos Institucionais ──────────────────────────────────

export interface SchoolEvent {
  id: string;
  title: string;
  event_date: string;          // 'YYYY-MM-DD'
  start_time: string | null;   // 'HH:MM:SS' or null
  location: string | null;
  unit: 'barra' | 'recreio' | 'campo_grande' | null;
  created_by: string;
  status: 'active' | 'cancelled';
  notify_leadership: boolean;
  notify_school: boolean;
  notify_unit: boolean;
  notify_day_of: boolean;
  created_at: string;
}

export interface EventAnnouncement {
  id: string;
  body: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduled_at: string | null;
  source_event_id: string;
}

export interface SchoolEventWithAnnouncements extends SchoolEvent {
  announcements: EventAnnouncement[];
}

export function unitLabel(unit: string | null): string {
  if (!unit) return 'Escola toda';
  const map: Record<string, string> = {
    barra: 'Barra',
    recreio: 'Recreio',
    campo_grande: 'Campo Grande',
    all: 'Todas',
  };
  return map[unit] ?? unit;
}

export function formatEventDate(eventDate: string, startTime: string | null): string {
  const [y, m, d] = eventDate.split('-');
  const date = `${d}/${m}/${y}`;
  const time = startTime ? ` às ${startTime.slice(0, 5)}` : '';
  return `${date}${time}`;
}

// Computes scheduled_at for event notification steps (browser-side).
// T-N days at 09:00 BRT (UTC-3 = UTC+12:00 for 09:00 BRT = 12:00 UTC).
// Returns null if the target time is already past (catch-up = immediate dispatch).
export function computeStepScheduledAt(eventDate: string, daysBefore: number): string | null {
  const [y, m, d] = eventDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d - daysBefore, 12, 0, 0)); // 09:00 BRT
  return target > new Date() ? target.toISOString() : null;
}

// ─── Sprint 15 — Camada Operacional Replicável ──────────────────────────────

export interface Department {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  unit_scope_enabled: boolean;
}

export interface DepartmentRequestType {
  id: string;
  department_id: string;
  slug: string;
  label: string;
  default_priority: TaskPriority;
  requires_approval: boolean;
  generates_task: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface OperationalTask extends Task {
  department_id: string | null;
  request_type_id: string | null;
  description: string | null;
  notes: string | null;
  request_type?: { id: string; slug: string; label: string } | null;
  department?: { id: string; slug: string; name: string } | null;
  collaborator?: { id: string; full_name: string; unit: string | null } | null;
}

export const STATUS_LABEL_OPERATIONAL: Record<string, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  awaiting_confirmation: 'Aguardando aprovação',
  done: 'Concluída',
  cancelled: 'Cancelada',
  overdue: 'Atrasada',
  delegated: 'Delegada',
};

export const PRIORITY_INDICATOR: Record<TaskPriority, { emoji: string; tone: string }> = {
  critical: { emoji: '🔴', tone: 'text-danger' },
  high:     { emoji: '🟠', tone: 'text-warning' },
  medium:   { emoji: '🟡', tone: 'text-fg' },
  low:      { emoji: '🟢', tone: 'text-success' },
};

// Generates announcement specs for each active notification step.
export function buildEventAnnouncements(ev: {
  title: string;
  event_date: string;
  start_time: string | null;
  unit: string | null;
  location: string | null;
  notify_leadership: boolean;
  notify_school: boolean;
  notify_unit: boolean;
  notify_day_of: boolean;
}): Array<{ body: string; audience: AnnouncementAudience; scheduled_at: string | null }> {
  const [y, m, d] = ev.event_date.split('-');
  const timeStr = ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : '';
  const locStr = ev.location ? `, ${ev.location}` : '';
  const dateBR = `${d}/${m}/${y}`;
  const specs: Array<{ body: string; audience: AnnouncementAudience; scheduled_at: string | null }> = [];
  if (ev.notify_leadership) {
    specs.push({
      body: `📅 Novo evento: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { function_role: ['director', 'coordinator'] },
      scheduled_at: null,
    });
  }
  if (ev.notify_school) {
    specs.push({
      body: `📅 Em 3 dias: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: { all: true },
      scheduled_at: computeStepScheduledAt(ev.event_date, 3),
    });
  }
  if (ev.notify_unit) {
    specs.push({
      body: `📅 Amanhã: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: ev.unit ? { unidade: [ev.unit] } : { all: true },
      scheduled_at: computeStepScheduledAt(ev.event_date, 1),
    });
  }
  if (ev.notify_day_of) {
    const [yn, mn, dn] = ev.event_date.split('-').map(Number);
    const T0 = new Date(Date.UTC(yn, mn - 1, dn, 12, 0, 0));
    specs.push({
      body: `📅 Hoje: *${ev.title}* — ${dateBR}${timeStr}${locStr}`,
      audience: ev.unit ? { unidade: [ev.unit] } : { all: true },
      scheduled_at: T0 > new Date() ? T0.toISOString() : null,
    });
  }
  return specs;
}
