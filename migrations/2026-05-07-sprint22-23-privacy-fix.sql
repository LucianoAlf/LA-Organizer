-- Sprint 22.23 — Privacidade RLS hardening
--
-- Auditoria identificou 2 gaps em tasks: coord/director conseguia UPDATE/DELETE
-- em tasks com context='personal' (apesar de NÃO conseguir READ — auth_read_work_tasks_coord
-- já filtra context='work'). Se um coord soubesse o ID de uma task pessoal de
-- outra pessoa, conseguia modificar/apagar.
--
-- Fix: adicionar AND context='work' nas policies de UPDATE e DELETE pra coord/director.
-- Agora coord/director só pode mexer em tasks de trabalho — pessoais ficam blindadas
-- (só o dono pode UPDATE/DELETE via auth_modify_own_tasks, que já era restrito ao owner).
--
-- Impacto: 27 tasks pessoais que estavam expostas a modificacao por coord/director.
-- Sem mudança no PWA — comportamento já era consistente (coord não vê personal,
-- então nem clicava). Mas a defesa em profundidade fecha o vetor.

DROP POLICY IF EXISTS auth_update_tasks_coord ON tasks;
CREATE POLICY auth_update_tasks_coord ON tasks FOR UPDATE TO authenticated
  USING (context = 'work' AND current_collab_role() IN ('coordinator', 'director'));

DROP POLICY IF EXISTS auth_delete_tasks_coord ON tasks;
CREATE POLICY auth_delete_tasks_coord ON tasks FOR DELETE TO authenticated
  USING (context = 'work' AND current_collab_role() IN ('coordinator', 'director'));
