-- Grupos de tarefas (Rose/To-Do): mãe agrupa subtarefas; subtarefa é task real.
-- Aplicada via MCP em 2026-06-09 (migrations task_groups + task_group_child_unique).
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- 1 nível só: filha não pode ser grupo.
ALTER TABLE tasks ADD CONSTRAINT tasks_no_nested_groups
  CHECK (NOT (is_group AND parent_task_id IS NOT NULL));

-- Defesa-em-profundidade (review 09/06): impede filha-instância duplicada pro mesmo
-- par (filha-template, mãe-instância) na corrida cron-00:30 × client.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_group_child_instance_uq
  ON tasks (recurrence_parent_id, parent_task_id)
  WHERE parent_task_id IS NOT NULL AND recurrence_parent_id IS NOT NULL;
