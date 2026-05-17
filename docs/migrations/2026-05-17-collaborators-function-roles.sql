-- Migration: Popular function_role nos collaborators que vão acessar inventário
-- Sprint: Inventário Bidirecional (Fase A)
-- Aplicar em: LA Organizer Supabase (cesnbnrynvxvgdhfmaua)
-- Data: 2026-05-17
--
-- Contexto: A coluna function_role foi criada na Sprint 22.51 como nullable.
-- A nova governança de acesso (checkAccess) depende dela populada pra:
--   - Rafinha (ops_tecnicas) → acesso total a inventário + valor patrimonial + loja
--   - Hugo (tech) → acesso a inventário e movimentações (infra)
--   - Yuri (marketing) → bloqueio explícito de inventário (verificação)
--
-- Farmers, Hunters, Backoffice e demais perfis serão populados quando
-- forem cadastrados no LA Organizer (Fase B+).

BEGIN;

-- Rafinha — Operações Técnicas (acesso amplo)
UPDATE collaborators
   SET function_role = 'ops_tecnicas'
 WHERE full_name ILIKE 'Rafinha%'
   AND function_role IS NULL;

-- Hugo — Tecnologia
UPDATE collaborators
   SET function_role = 'tech'
 WHERE full_name ILIKE 'Hugo%'
   AND function_role IS NULL;

-- Yuri — Marketing
UPDATE collaborators
   SET function_role = 'marketing'
 WHERE full_name ILIKE 'Yuri%'
   AND function_role IS NULL;

-- Verificação: listar quem ficou com função e quem não
-- (rode esse SELECT manualmente após o COMMIT pra conferir)
-- SELECT id, full_name, role, function_role, unit FROM collaborators
--  WHERE full_name ILIKE ANY (ARRAY['Rafinha%','Hugo%','Yuri%'])
--  ORDER BY full_name;

COMMIT;
