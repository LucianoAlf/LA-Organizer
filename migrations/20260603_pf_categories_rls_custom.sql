-- Categorias personalizadas — RLS de escrita em pf_categories
-- Data: 2026-06-03
--
-- VERIFICAÇÃO (2026-06-03): RLS já estava habilitada e correta neste projeto.
-- As políticas existentes já satisfazem o design de categorias custom:
--   pf_categories_read  (SELECT): collaborator_id IS NULL OR collaborator_id = current_collab_id()
--                                 → cada um vê os defaults globais + as próprias.
--   pf_categories_write (ALL):    collaborator_id = current_collab_id()  (USING + WITH CHECK)
--                                 → INSERT/UPDATE/DELETE só em linhas próprias.
--                                   Defaults (collaborator_id NULL) ficam intocáveis porque
--                                   NULL nunca casa com current_collab_id().
--
-- Conclusão: NENHUMA mudança de schema/policy foi necessária. O bloco abaixo é
-- idempotente — recria exatamente o estado verificado caso o ambiente não as tenha.

ALTER TABLE pf_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pf_categories_read ON pf_categories;
CREATE POLICY pf_categories_read ON pf_categories FOR SELECT
  USING (collaborator_id IS NULL OR collaborator_id = current_collab_id());

DROP POLICY IF EXISTS pf_categories_write ON pf_categories;
CREATE POLICY pf_categories_write ON pf_categories FOR ALL
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());
