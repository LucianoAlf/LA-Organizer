-- ============================================================
-- 20260518_rls_recursion_hardening — aplicada via mcp em prod
-- Refatora cross-table RLS lookups em funções SECURITY DEFINER
-- pra eliminar risco de recursão e padronizar lógica.
--
-- Pontos cobertos (auditoria de 18/05):
-- 1. project_members (recursão direta — bug crítico)
-- 2. current_collab_unit (faltava search_path)
-- 3. task_reminders (delegava à RLS de tasks — lento + risco loop)
-- 4. habit_reminders (delegava à RLS de habits — risco loop)
-- 5. event_runbook_blocks/items (delegação frágil + JOIN triplo)
-- 6. project_checkpoints (delegava à RLS de projects+members)
-- 7. la_educa_avaliacoes, la_journey_marco_campos (JOIN triplo)
--
-- Padrão: toda lógica cross-table vira função SECURITY DEFINER
-- com SET search_path; policies viram chamadas simples.
-- ============================================================

ALTER FUNCTION public.current_collab_unit() SET search_path TO 'public';

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid, p_collab_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM project_members
                 WHERE project_id = p_project_id AND collaborator_id = p_collab_id)
      OR EXISTS (SELECT 1 FROM projects
                 WHERE id = p_project_id AND created_by = p_collab_id);
$$;

CREATE OR REPLACE FUNCTION public.is_project_lead(p_project_id uuid, p_collab_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM project_members
                 WHERE project_id = p_project_id AND collaborator_id = p_collab_id
                   AND role_in_project = ANY (ARRAY['owner','coordinator']))
      OR EXISTS (SELECT 1 FROM projects
                 WHERE id = p_project_id AND created_by = p_collab_id);
$$;

CREATE OR REPLACE FUNCTION public.is_task_assignee(p_task_id uuid, p_collab_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM tasks
                 WHERE id = p_task_id
                   AND (assigned_to = p_collab_id OR created_by = p_collab_id));
$$;

CREATE OR REPLACE FUNCTION public.is_habit_owner(p_habit_id uuid, p_collab_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM habits
                 WHERE id = p_habit_id AND collaborator_id = p_collab_id);
$$;

CREATE OR REPLACE FUNCTION public.is_runbook_block_accessible(p_block_id uuid, p_collab_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_runbook_blocks b
    WHERE b.id = p_block_id
      AND (is_project_member(b.project_id, p_collab_id)
           OR (SELECT role FROM collaborators WHERE id = p_collab_id)
              = ANY (ARRAY['coordinator','director','manager']))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_evaluate_estagiario(p_estagiario_id uuid, p_checkpoint_id text, p_collab_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM la_educa_estagiarios e
    WHERE e.id = p_estagiario_id
      AND (e.mentor_id = p_collab_id
           OR (SELECT role FROM collaborators WHERE id = p_collab_id)
              = ANY (ARRAY['coordinator','director']))
  ) OR EXISTS (
    SELECT 1 FROM la_educa_responsaveis_pilar r
    JOIN la_educa_checkpoints cp ON cp.pilar_id = r.pilar_id
    WHERE r.estagiario_id = p_estagiario_id
      AND cp.id = p_checkpoint_id
      AND r.instrutor_id = p_collab_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_marco_campo(p_marco_id uuid, p_collab_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT (SELECT role FROM collaborators WHERE id = p_collab_id)
         = ANY (ARRAY['coordinator','director'])
      OR EXISTS (
        SELECT 1 FROM la_journey_marcos mr
        JOIN la_journey_conteudo_checkpoint cc ON cc.id = mr.conteudo_id
        JOIN la_journey_curso_mentores m
          ON m.curso_id = cc.curso_id AND m.programa_id = cc.programa_id
        WHERE mr.id = p_marco_id AND m.collaborator_id = p_collab_id AND m.ativo = true
      );
$$;

-- Refazimento das policies (todas usando as funções acima).
-- DDL completo aplicado via mcp em 18/05/2026 às 19:55 BRT.
-- Migration `rls_recursion_hardening_v2_2026_05_18` no supabase_migrations.
