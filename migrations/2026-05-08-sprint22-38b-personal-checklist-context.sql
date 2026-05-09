-- Sprint 22.38b — Adicionar coluna `context` em personal_checklists.
-- Permite separar listas Pessoais (mercado/viagem/remédios) de listas de Trabalho.
-- Trabalho tab em /checklists pode mostrar context='work' alongside op_checklist_completions.

ALTER TABLE personal_checklists
  ADD COLUMN context text NOT NULL DEFAULT 'personal'
  CHECK (context IN ('personal', 'work'));

CREATE INDEX personal_checklists_owner_context_idx
  ON personal_checklists (owner_collab_id, context, is_active);
