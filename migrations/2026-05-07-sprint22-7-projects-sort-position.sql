-- Sprint 22.7 — projects.sort_position pra reorder manual da listagem.
-- Backfill por created_at desc (mais recente fica em cima por padrao).

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS sort_position int;

COMMENT ON COLUMN public.projects.sort_position IS
  'Posicao manual do projeto na listagem. NULL = fallback pra created_at desc.';

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) - 1 AS rn
  FROM public.projects
  WHERE sort_position IS NULL
)
UPDATE public.projects p SET sort_position = ranked.rn FROM ranked WHERE p.id = ranked.id;
