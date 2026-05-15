-- Migration: 20260515000000_checklist_responsaveis
-- Adds explicit responsible_id and leader_id to op_checklists.
-- Both nullable — legacy templates without these set fall back to function_role+shift matching in the dispatcher.
-- Adds justification fields to op_checklist_completions for leader acknowledgement flow.

ALTER TABLE op_checklists
  ADD COLUMN IF NOT EXISTS responsible_id UUID REFERENCES collaborators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS leader_id      UUID REFERENCES collaborators(id) ON DELETE SET NULL;

ALTER TABLE op_checklist_completions
  ADD COLUMN IF NOT EXISTS justification   TEXT,
  ADD COLUMN IF NOT EXISTS justified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS justified_by_id UUID REFERENCES collaborators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_op_checklists_responsible_id ON op_checklists(responsible_id);
CREATE INDEX IF NOT EXISTS idx_op_checklists_leader_id      ON op_checklists(leader_id);
