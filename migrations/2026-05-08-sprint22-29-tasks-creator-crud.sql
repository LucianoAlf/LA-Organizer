-- Sprint 22.29 (Bucket 4 da audit Hoje) — creator pode reagendar/excluir tasks
-- que delegou. Antes, so o assigned_to (owner) ou coord/director conseguiam
-- mexer; quem delegou nao tinha jeito de cancelar/reagendar via PWA.
--
-- Defesa em profundidade: creator so mexe em context='work'. Tasks personal
-- ficam intocaveis por terceiros (compatibilidade com Sprint 22.23 privacy).

CREATE POLICY auth_update_created_tasks ON tasks FOR UPDATE TO authenticated
  USING (created_by = current_collab_id() AND context = 'work');

CREATE POLICY auth_delete_own_tasks ON tasks FOR DELETE TO authenticated
  USING (
    assigned_to = current_collab_id()
    OR (created_by = current_collab_id() AND context = 'work')
  );
