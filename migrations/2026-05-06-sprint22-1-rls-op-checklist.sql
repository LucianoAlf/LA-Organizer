-- Sprint 22.1 — Fechar gap RLS em op_checklist_completions + op_checklist_item_completions.
-- PWA faz .update() em ChecklistCard.tsx:60 e .upsert() em ChecklistCard.tsx:44 mas RLS
-- só permitia service_role. Sem essas policies, user autenticado não consegue marcar item.
--
-- op_checklist_completions tem collaborator_id direto.
-- op_checklist_item_completions herda via completion_id → op_checklist_completions(collaborator_id).

CREATE POLICY auth_read_own_checklist_completions
  ON public.op_checklist_completions
  FOR SELECT
  USING (collaborator_id = current_collab_id());

CREATE POLICY auth_insert_own_checklist_completions
  ON public.op_checklist_completions
  FOR INSERT
  WITH CHECK (collaborator_id = current_collab_id());

CREATE POLICY auth_update_own_checklist_completions
  ON public.op_checklist_completions
  FOR UPDATE
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());

CREATE POLICY auth_read_own_item_completions
  ON public.op_checklist_item_completions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_item_completions.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  );

CREATE POLICY auth_insert_own_item_completions
  ON public.op_checklist_item_completions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_item_completions.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  );

CREATE POLICY auth_update_own_item_completions
  ON public.op_checklist_item_completions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_item_completions.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM op_checklist_completions c
      WHERE c.id = op_checklist_item_completions.completion_id
        AND c.collaborator_id = current_collab_id()
    )
  );
