-- Sprint 21: Autogovernança Guiada — cumulative schema migration
-- 2026-05-05

-- 1. Nova tabela monthly_plans
CREATE TABLE monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  month_start date NOT NULL,
  goals text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','skipped')),
  tasks_planned integer NOT NULL DEFAULT 0,
  tasks_completed integer NOT NULL DEFAULT 0,
  completion_rate numeric NOT NULL DEFAULT 0,
  retrospective_notes text,
  wins text[] NOT NULL DEFAULT '{}',
  carry_over_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collaborator_id, month_start)
);
ALTER TABLE monthly_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON monthly_plans FOR ALL USING (true);
CREATE POLICY "auth_read_own" ON monthly_plans FOR SELECT TO authenticated
  USING (collaborator_id = current_collab_id() OR current_collab_role() IN ('coordinator','director'));
CREATE POLICY "auth_write_own" ON monthly_plans FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());

-- 2. tasks.source CHECK estendido
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual','agent_briefing','agent_closing',
                    'checkpoint_decomposition','coordinator_assignment',
                    'system','mental_dump','retroactive_capture'));

-- 3. user_preferences — horários dos rituais mensais
ALTER TABLE user_preferences
  ADD COLUMN monthly_planning_time time NOT NULL DEFAULT '07:00',
  ADD COLUMN monthly_closing_time  time NOT NULL DEFAULT '18:00';
