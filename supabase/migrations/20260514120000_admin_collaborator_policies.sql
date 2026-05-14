-- Sprint 23.6: Admin panel — gestão de equipe
-- Policies para directors/coordinators/managers verem e editarem TODOS os colaboradores.
-- Usa SECURITY DEFINER function para evitar recursão infinita (PostgreSQL RLS limitação:
-- policies ON collaborators não podem fazer SELECT FROM collaborators diretamente).

-- Helper: roda como definer (bypasses RLS no inner query) para quebrar o ciclo.
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE email = auth.email()
      AND role IN ('director', 'coordinator', 'manager')
      AND is_active = true
  );
$$;

-- Segurança: só authenticated pode chamar a função.
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

-- Índice para acelerar a query da função.
CREATE INDEX IF NOT EXISTS idx_collaborators_email_role_active
  ON public.collaborators (email, role, is_active)
  WHERE is_active = true;

-- SELECT: admins veem todos os colaboradores (ativos e inativos).
DROP POLICY IF EXISTS "collaborators_admin_select" ON collaborators;
CREATE POLICY "collaborators_admin_select" ON collaborators
  FOR SELECT TO authenticated
  USING (public.current_user_is_admin());

-- UPDATE: admins podem atualizar qualquer colaborador.
DROP POLICY IF EXISTS "collaborators_admin_update" ON collaborators;
CREATE POLICY "collaborators_admin_update" ON collaborators
  FOR UPDATE TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (true);
