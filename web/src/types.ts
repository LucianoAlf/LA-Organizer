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

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'overdue' | 'delegated';
export type TaskContext = 'personal' | 'work';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type Quadrant = 'q1' | 'q2' | 'q3' | 'q4' | null;

// Sprint 3 — informational categorization shared by tasks + events.
// NOT a security axis. Privacy lives in `context`. See docs/MODELO-EVENTS-VS-TASKS.md.
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

// Default mapping at creation: pessoal → personal; demais → work.
// User can override only via UI (Sprint 4+ feature). Sprint 3 keeps simple.
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
  projects?: { name: string } | null;
}

export type EventStatus = 'scheduled' | 'done' | 'cancelled';
export type EventModality = 'online' | 'presencial' | 'hibrido';

export interface CalendarEvent {
  id: string;
  collaborator_id: string;
  title: string;
  description: string | null;
  context: TaskContext;
  category: Category;
  start_at: string;       // ISO with TZ
  end_at: string;
  modality: EventModality;
  location_text: string | null;
  meeting_url: string | null;
  project_id: string | null;
  status: EventStatus;
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
