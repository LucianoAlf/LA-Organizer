-- Sprint 22.36 — Checklist Design System + DnD + CRUD + TOM Integration.
-- Cumulativa: meta 100%, reorder per-user, items ad-hoc, cobrança/escalação.

-- 1. Meta 100% em todos os templates ativos
UPDATE op_checklists SET completion_threshold = 100;

-- 2. Reorder per-user (NULL = usa template default)
ALTER TABLE op_checklist_item_completions
  ADD COLUMN IF NOT EXISTS user_sort_order INTEGER;

-- 3. Items ad-hoc por instância de checklist
CREATE TABLE IF NOT EXISTS op_checklist_completion_extra_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id UUID NOT NULL REFERENCES op_checklist_completions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  is_checked BOOLEAN DEFAULT false,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 9999,
  user_sort_order INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES collaborators(id)
);

ALTER TABLE op_checklist_completion_extra_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_crud_own_extra_items ON op_checklist_completion_extra_items;
CREATE POLICY auth_crud_own_extra_items
  ON op_checklist_completion_extra_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_completion_extra_items.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_completion_extra_items.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  );

-- 4. Cobrança/escalação para Fatia 6
ALTER TABLE op_checklist_completions
  ADD COLUMN IF NOT EXISTS reminded_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_replied BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalated_at     TIMESTAMPTZ;

-- Índice pra query rápida do cron de cobrança
CREATE INDEX IF NOT EXISTS idx_op_checklist_completions_reminder_query
  ON op_checklist_completions (completed_at, reminded_at, dispatched_at);
