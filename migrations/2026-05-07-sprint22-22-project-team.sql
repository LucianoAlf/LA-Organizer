-- Sprint 22.22 — Time do Projeto + Atribuicoes
-- Permite project_members com membro interno (collaborator) OU externo (guest).
-- Adiciona policy faltante pra coord/director criar tasks atribuidas a outros.

-- 1. Enum fixo de role_in_project (3 valores: owner / coordinator / member)
DO $$ BEGIN
  ALTER TABLE public.project_members
    DROP CONSTRAINT IF EXISTS project_members_role_check;
END $$;

ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role_in_project IN ('owner', 'coordinator', 'member'));

-- 2. Suporte a membros externos (guests)
ALTER TABLE public.project_members ALTER COLUMN collaborator_id DROP NOT NULL;
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS guest_role text;

DO $$ BEGIN
  ALTER TABLE public.project_members
    DROP CONSTRAINT IF EXISTS project_members_member_or_guest;
END $$;

ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_member_or_guest
  CHECK (
    (collaborator_id IS NOT NULL AND guest_name IS NULL) OR
    (collaborator_id IS NULL AND guest_name IS NOT NULL)
  );

COMMENT ON COLUMN public.project_members.guest_name IS
  'Nome do membro externo (prestador de servico). NULL quando collaborator_id preenchido.';
COMMENT ON COLUMN public.project_members.guest_role IS
  'Funcao do membro externo (iluminador, tecnico de som, etc). Texto livre.';

-- 3. RLS: members podem CRUD em project_members do projeto onde sao owner ou coordinator
DROP POLICY IF EXISTS auth_update_project_members ON public.project_members;
CREATE POLICY auth_update_project_members ON public.project_members
  FOR UPDATE TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE collaborator_id = current_collab_id()
        AND role_in_project IN ('owner', 'coordinator')
    )
    OR current_collab_role() = ANY (ARRAY['coordinator'::text, 'director'::text])
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE collaborator_id = current_collab_id()
        AND role_in_project IN ('owner', 'coordinator')
    )
    OR current_collab_role() = ANY (ARRAY['coordinator'::text, 'director'::text])
  );

DROP POLICY IF EXISTS auth_delete_project_members ON public.project_members;
CREATE POLICY auth_delete_project_members ON public.project_members
  FOR DELETE TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE collaborator_id = current_collab_id()
        AND role_in_project IN ('owner', 'coordinator')
    )
    OR current_collab_role() = ANY (ARRAY['coordinator'::text, 'director'::text])
  );

-- 4. Policy nova: coord/director pode INSERT tasks atribuidas a OUTROS colaboradores
-- (hoje so consegue criar pra si mesmo via auth_insert_own_tasks)
DROP POLICY IF EXISTS auth_insert_tasks_coord ON public.tasks;
CREATE POLICY auth_insert_tasks_coord ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    current_collab_role() = ANY (ARRAY['coordinator'::text, 'director'::text])
    AND created_by = current_collab_id()
  );

-- 5. Policy nova: members podem ler tasks de projetos onde sao owner/coord (pra ver tasks do time)
DROP POLICY IF EXISTS auth_read_tasks_project_lead ON public.tasks;
CREATE POLICY auth_read_tasks_project_lead ON public.tasks
  FOR SELECT TO authenticated
  USING (
    context = 'work'
    AND project_id IN (
      SELECT project_id FROM project_members
      WHERE collaborator_id = current_collab_id()
        AND role_in_project IN ('owner', 'coordinator')
    )
  );
