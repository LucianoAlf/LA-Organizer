-- Sprint 22.4 — Adiciona tasks.sort_position pra reorder manual de tarefas dentro de
-- um checkpoint. project_checkpoints.sort_order ja existia desde antes.
--
-- Backfill: cada (project_id, checkpoint_id) recebe posicoes 0..N-1 baseadas em
-- created_at. Tarefas sem project_id ficam NULL (nao reordenam — sao diarias soltas).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sort_position int;

COMMENT ON COLUMN public.tasks.sort_position IS
  'Posicao manual da tarefa dentro de um checkpoint (ou no projeto inteiro se sem checkpoint). Quando NULL, fallback pra due_date / created_at.';

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id, checkpoint_id ORDER BY created_at) - 1 AS rn
  FROM public.tasks
  WHERE project_id IS NOT NULL AND sort_position IS NULL
)
UPDATE public.tasks t SET sort_position = ranked.rn FROM ranked WHERE t.id = ranked.id;
