-- ============================================================
-- relax_rls_global — 2026-05-18
-- Objetivo: destravar coordinator/manager/collaborator em
-- operações básicas. Padrão aplicado:
--   * INSERT: with_check apenas (created_by/invited_by = self)
--   * UPDATE/DELETE: dono OU criador OU coord/director
--   * SELECT: mantido (ou ampliado quando bloqueia leitura óbvia)
-- ============================================================

-- ---------- 0. Hardening das funções RLS ----------
CREATE OR REPLACE FUNCTION public.current_collab_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role FROM collaborators WHERE id = current_collab_id();
$$;

-- ---------- 1. event_participants ----------
DROP POLICY IF EXISTS auth_insert_event_participants ON public.event_participants;
CREATE POLICY auth_insert_event_participants ON public.event_participants
  FOR INSERT TO authenticated
  WITH CHECK (invited_by = current_collab_id());

DROP POLICY IF EXISTS auth_update_event_participants ON public.event_participants;
CREATE POLICY auth_update_event_participants ON public.event_participants
  FOR UPDATE TO authenticated
  USING (
    collaborator_id = current_collab_id()
    OR invited_by = current_collab_id()
    OR EXISTS (SELECT 1 FROM events e WHERE e.id = event_participants.event_id
               AND (e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id()))
    OR current_collab_role() = ANY (ARRAY['coordinator','director'])
  );

DROP POLICY IF EXISTS auth_delete_event_participants ON public.event_participants;
CREATE POLICY auth_delete_event_participants ON public.event_participants
  FOR DELETE TO authenticated
  USING (
    invited_by = current_collab_id()
    OR EXISTS (SELECT 1 FROM events e WHERE e.id = event_participants.event_id
               AND (e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id()))
    OR current_collab_role() = ANY (ARRAY['coordinator','director'])
  );

-- ---------- 2. event_reminders ----------
-- Permite criador do evento + participantes + coord/director
DROP POLICY IF EXISTS event_reminders_insert ON public.event_reminders;
CREATE POLICY event_reminders_insert ON public.event_reminders
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_reminders.event_id
            AND (e.collaborator_id = current_collab_id()
                 OR e.created_by = current_collab_id()
                 OR EXISTS (SELECT 1 FROM event_participants ep
                            WHERE ep.event_id = e.id AND ep.collaborator_id = current_collab_id())))
  );

DROP POLICY IF EXISTS event_reminders_update ON public.event_reminders;
CREATE POLICY event_reminders_update ON public.event_reminders
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_reminders.event_id
            AND (e.collaborator_id = current_collab_id() OR e.created_by = current_collab_id()))
  );

DROP POLICY IF EXISTS event_reminders_delete ON public.event_reminders;
CREATE POLICY event_reminders_delete ON public.event_reminders
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_reminders.event_id
            AND (e.collaborator_id = current_collab_id() OR e.created_by = current_collab_id()))
  );

-- ---------- 3. event_runbook_blocks ----------
DROP POLICY IF EXISTS auth_insert_runbook_blocks ON public.event_runbook_blocks;
CREATE POLICY auth_insert_runbook_blocks ON public.event_runbook_blocks
  FOR INSERT TO authenticated
  WITH CHECK (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR project_id IN (SELECT pm.project_id FROM project_members pm
                      WHERE pm.collaborator_id = current_collab_id())
    OR project_id IN (SELECT p.id FROM projects p WHERE p.created_by = current_collab_id())
  );

DROP POLICY IF EXISTS auth_update_runbook_blocks ON public.event_runbook_blocks;
CREATE POLICY auth_update_runbook_blocks ON public.event_runbook_blocks
  FOR UPDATE TO authenticated
  USING (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR project_id IN (SELECT pm.project_id FROM project_members pm
                      WHERE pm.collaborator_id = current_collab_id())
    OR project_id IN (SELECT p.id FROM projects p WHERE p.created_by = current_collab_id())
  );

DROP POLICY IF EXISTS auth_delete_runbook_blocks ON public.event_runbook_blocks;
CREATE POLICY auth_delete_runbook_blocks ON public.event_runbook_blocks
  FOR DELETE TO authenticated
  USING (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR project_id IN (SELECT pm.project_id FROM project_members pm
                      WHERE pm.collaborator_id = current_collab_id())
    OR project_id IN (SELECT p.id FROM projects p WHERE p.created_by = current_collab_id())
  );

-- ---------- 4. event_runbook_items ----------
DROP POLICY IF EXISTS auth_insert_runbook_items ON public.event_runbook_items;
CREATE POLICY auth_insert_runbook_items ON public.event_runbook_items
  FOR INSERT TO authenticated
  WITH CHECK (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR block_id IN (SELECT b.id FROM event_runbook_blocks b
                    JOIN project_members pm ON pm.project_id = b.project_id
                    WHERE pm.collaborator_id = current_collab_id())
    OR block_id IN (SELECT b.id FROM event_runbook_blocks b
                    JOIN projects p ON p.id = b.project_id
                    WHERE p.created_by = current_collab_id())
  );

DROP POLICY IF EXISTS auth_update_runbook_items ON public.event_runbook_items;
CREATE POLICY auth_update_runbook_items ON public.event_runbook_items
  FOR UPDATE TO authenticated
  USING (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR block_id IN (SELECT b.id FROM event_runbook_blocks b
                    JOIN project_members pm ON pm.project_id = b.project_id
                    WHERE pm.collaborator_id = current_collab_id())
    OR block_id IN (SELECT b.id FROM event_runbook_blocks b
                    JOIN projects p ON p.id = b.project_id
                    WHERE p.created_by = current_collab_id())
  );

DROP POLICY IF EXISTS auth_delete_runbook_items ON public.event_runbook_items;
CREATE POLICY auth_delete_runbook_items ON public.event_runbook_items
  FOR DELETE TO authenticated
  USING (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR block_id IN (SELECT b.id FROM event_runbook_blocks b
                    JOIN project_members pm ON pm.project_id = b.project_id
                    WHERE pm.collaborator_id = current_collab_id())
    OR block_id IN (SELECT b.id FROM event_runbook_blocks b
                    JOIN projects p ON p.id = b.project_id
                    WHERE p.created_by = current_collab_id())
  );

-- ---------- 5. event_categories ----------
DROP POLICY IF EXISTS auth_update_event_categories ON public.event_categories;
CREATE POLICY auth_update_event_categories ON public.event_categories
  FOR UPDATE TO authenticated
  USING (
    (collaborator_id = current_collab_id() AND is_system = false)
    OR (is_system = false AND current_collab_role() = ANY (ARRAY['coordinator','director']))
  );

DROP POLICY IF EXISTS auth_delete_event_categories ON public.event_categories;
CREATE POLICY auth_delete_event_categories ON public.event_categories
  FOR DELETE TO authenticated
  USING (
    (collaborator_id = current_collab_id() AND is_system = false)
    OR (is_system = false AND current_collab_role() = ANY (ARRAY['coordinator','director']))
  );

-- ---------- 6. tasks (criador pode atualizar/deletar em qualquer contexto) ----------
DROP POLICY IF EXISTS auth_update_created_tasks ON public.tasks;
-- já existe auth_update_creator_tasks que cobre criador em ambos contextos; nada a fazer

DROP POLICY IF EXISTS auth_delete_own_tasks ON public.tasks;
CREATE POLICY auth_delete_own_tasks ON public.tasks
  FOR DELETE TO authenticated
  USING (
    assigned_to = current_collab_id()
    OR created_by = current_collab_id()
  );

-- ---------- 7. projects (criador manager pode atualizar/deletar) ----------
DROP POLICY IF EXISTS auth_update_projects_coord ON public.projects;
CREATE POLICY auth_update_projects_relaxed ON public.projects
  FOR UPDATE TO authenticated
  USING (
    created_by = current_collab_id()
    OR current_collab_role() = ANY (ARRAY['coordinator','director'])
    OR id IN (SELECT pm.project_id FROM project_members pm
              WHERE pm.collaborator_id = current_collab_id()
              AND pm.role_in_project = ANY (ARRAY['owner','coordinator']))
  )
  WITH CHECK (
    created_by = current_collab_id()
    OR current_collab_role() = ANY (ARRAY['coordinator','director'])
    OR id IN (SELECT pm.project_id FROM project_members pm
              WHERE pm.collaborator_id = current_collab_id()
              AND pm.role_in_project = ANY (ARRAY['owner','coordinator']))
  );

DROP POLICY IF EXISTS auth_delete_projects_coord ON public.projects;
CREATE POLICY auth_delete_projects_relaxed ON public.projects
  FOR DELETE TO authenticated
  USING (
    created_by = current_collab_id()
    OR current_collab_role() = ANY (ARRAY['coordinator','director'])
  );

-- ---------- 8. project_checkpoints (DELETE) ----------
DROP POLICY IF EXISTS auth_delete_project_checkpoints ON public.project_checkpoints;
CREATE POLICY auth_delete_project_checkpoints ON public.project_checkpoints
  FOR DELETE TO authenticated
  USING (
    project_id IN (SELECT p.id FROM projects p
                   WHERE p.created_by = current_collab_id()
                   OR p.id IN (SELECT pm.project_id FROM project_members pm
                               WHERE pm.collaborator_id = current_collab_id()))
    OR current_collab_role() = ANY (ARRAY['coordinator','director'])
  );

-- ---------- 9. project_contingencies (permite manager + criador do projeto) ----------
DROP POLICY IF EXISTS auth_write_project_contingencies ON public.project_contingencies;
CREATE POLICY auth_write_project_contingencies ON public.project_contingencies
  FOR ALL TO authenticated
  USING (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR project_id IN (SELECT p.id FROM projects p WHERE p.created_by = current_collab_id())
    OR project_id IN (SELECT pm.project_id FROM project_members pm
                      WHERE pm.collaborator_id = current_collab_id())
  )
  WITH CHECK (
    current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
    OR project_id IN (SELECT p.id FROM projects p WHERE p.created_by = current_collab_id())
    OR project_id IN (SELECT pm.project_id FROM project_members pm
                      WHERE pm.collaborator_id = current_collab_id())
  );

-- ---------- 10. school_events (manager pode criar/editar) ----------
DROP POLICY IF EXISTS school_events_write ON public.school_events;
CREATE POLICY school_events_write ON public.school_events
  FOR ALL TO authenticated
  USING (current_collab_role() = ANY (ARRAY['director','coordinator','manager']))
  WITH CHECK (current_collab_role() = ANY (ARRAY['director','coordinator','manager']));

-- ============================================================
-- NOTA — NÃO alteradas (intencional):
--   * habits / habit_logs / habit_reminders: pessoal por design.
--   * personal_checklist_items: pessoal por design.
--   * announcements / announcement_jobs: gating director/coord proposital.
--   * la_educa_* / la_journey_marcos: domínio mentor/coord proposital.
--   * task_comments / project_members SELECT/INSERT: já permissivos.
-- ============================================================
