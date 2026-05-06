-- Sprint 22.2 — Fechar gaps RLS adicionais (auditoria pós Sprint 22.1).
-- Tabelas que o TOM (engine) grava via service_role mas o PWA precisa ler
-- como user autenticado. Sem essas policies, telas Hoje e Semana ficam vazias.
--
-- Bug-por-bug:
-- 1. daily_plans — PWA tela Hoje não consegue listar plano do dia
-- 2. daily_plan_items — itens do plano invisíveis (herda via daily_plan_id)
-- 3. weekly_plans — PWA tela Semana não consegue listar plano semanal
-- 4. collaborators read — managers/gerentes não viam outros collabs (faltava role na OR)
-- 5. tasks read — user via apenas tasks atribuídas a si (assigned_to);
--    agora também vê tasks que criou para outros (created_by)

CREATE POLICY auth_read_own_daily_plans
  ON public.daily_plans
  FOR SELECT
  TO authenticated
  USING (collaborator_id = current_collab_id());

CREATE POLICY auth_read_own_daily_plan_items
  ON public.daily_plan_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM daily_plans dp
      WHERE dp.id = daily_plan_items.daily_plan_id
        AND dp.collaborator_id = current_collab_id()
    )
  );

CREATE POLICY auth_read_own_weekly_plans
  ON public.weekly_plans
  FOR SELECT
  TO authenticated
  USING (collaborator_id = current_collab_id());

DROP POLICY IF EXISTS auth_read_collaborators ON public.collaborators;
CREATE POLICY auth_read_collaborators
  ON public.collaborators
  FOR SELECT
  TO authenticated
  USING (
    lower(email) = lower((auth.jwt() ->> 'email'::text))
    OR current_collab_role() = ANY (ARRAY['coordinator','director','manager'])
  );

CREATE POLICY auth_read_created_tasks
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (created_by = current_collab_id());
