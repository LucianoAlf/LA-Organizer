-- Sprint 22.5 — Fechar gaps RLS pra CRUD pelo PWA.
-- Director/coordinator gerenciam projetos. Sem essas policies, Excluir/Editar
-- silenciosamente nao faz nada (RLS bloqueia 0 rows sem retornar erro).
--
-- Tabelas/comandos cobertos aqui:
--   tasks UPDATE (coord/director) — pra editar/togglear tasks que nao foram
--      atribuidas a si (ex: tasks atribuidas a um coordenador, mas director
--      precisa mexer)
--   tasks DELETE (coord/director)
--   project_checkpoints DELETE (coord/director)
--   projects UPDATE (coord/director) — pra editar metadata do projeto
--   projects DELETE (coord/director)

DROP POLICY IF EXISTS auth_delete_tasks_coord ON public.tasks;
CREATE POLICY auth_delete_tasks_coord
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (current_collab_role() = ANY (ARRAY['coordinator','director']));

DROP POLICY IF EXISTS auth_update_tasks_coord ON public.tasks;
CREATE POLICY auth_update_tasks_coord
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (current_collab_role() = ANY (ARRAY['coordinator','director']))
  WITH CHECK (current_collab_role() = ANY (ARRAY['coordinator','director']));

DROP POLICY IF EXISTS auth_delete_project_checkpoints ON public.project_checkpoints;
CREATE POLICY auth_delete_project_checkpoints
  ON public.project_checkpoints
  FOR DELETE
  TO authenticated
  USING (current_collab_role() = ANY (ARRAY['coordinator','director']));

DROP POLICY IF EXISTS auth_update_projects_coord ON public.projects;
CREATE POLICY auth_update_projects_coord
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (current_collab_role() = ANY (ARRAY['coordinator','director']))
  WITH CHECK (current_collab_role() = ANY (ARRAY['coordinator','director']));

DROP POLICY IF EXISTS auth_delete_projects_coord ON public.projects;
CREATE POLICY auth_delete_projects_coord
  ON public.projects
  FOR DELETE
  TO authenticated
  USING (current_collab_role() = ANY (ARRAY['coordinator','director']));
