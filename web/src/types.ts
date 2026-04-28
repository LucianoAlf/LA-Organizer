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

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  context: TaskContext;
  priority: TaskPriority;
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

export interface Project {
  id: string;
  name: string;
  description: string | null;
  category: 'pedagogical' | 'commercial' | 'administrative' | 'operational' | 'event' | 'infrastructure';
  status: 'active' | 'paused' | 'done' | 'cancelled';
  progress_percent: number;
  start_date: string | null;
  end_date: string | null;
  created_by: string | null;
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
