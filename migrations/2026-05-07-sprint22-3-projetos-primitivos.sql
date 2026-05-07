-- Sprint 22.3 — Primitivos de Projeto (Phase A): rationale, contingências, event_date
--
-- Inspirado no app Musicolândia (Matheus Felipe). Três primitivos viram cidadãos
-- de primeira classe no LA Organizer:
--
-- 1. project_checkpoints.rationale  — texto curto explicando POR QUE o CP existe.
--    Renderizado em card 💡 acima dos itens. Reduz contaminação de erro entre etapas.
--
-- 2. project_contingencies          — pares (cenário, protocolo) por projeto.
--    "Se X acontecer → faça Y" definidos antes do evento, em qualquer categoria.
--
-- 3. projects.event_date            — data do evento. Precisa estar pronto agora porque
--    o Sprint 24 (Runbook T-minus) vai depender. Adicionar agora evita migration depois.
--
-- Idempotente: ALTERs com IF NOT EXISTS, CREATE TABLE IF NOT EXISTS.
-- Sem impacto no TOM (engine/dispatcher não leem essas colunas).

-- ----------------------------------------------------------------------------
-- 1. rationale em project_checkpoints
-- ----------------------------------------------------------------------------
ALTER TABLE public.project_checkpoints
  ADD COLUMN IF NOT EXISTS rationale text;

COMMENT ON COLUMN public.project_checkpoints.rationale IS
  'Markdown curto (~600 chars) explicando POR QUE este checkpoint existe. Renderizado em card 💡 acima dos itens.';

-- ----------------------------------------------------------------------------
-- 2. project_contingencies
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_contingencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scenario text NOT NULL,
  protocol text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_contingencies_project_id
  ON public.project_contingencies(project_id, position);

COMMENT ON TABLE public.project_contingencies IS
  'Cenários de risco e protocolo de resposta definidos antes da execução do projeto.';

-- RLS — segue padrão do projeto: leitura para auth com acesso ao projeto,
-- escrita para coordinator/director do projeto.
ALTER TABLE public.project_contingencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_project_contingencies ON public.project_contingencies;
CREATE POLICY auth_read_project_contingencies
  ON public.project_contingencies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_contingencies.project_id
    )
  );

DROP POLICY IF EXISTS auth_write_project_contingencies ON public.project_contingencies;
CREATE POLICY auth_write_project_contingencies
  ON public.project_contingencies
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.collaborators c
      WHERE c.id = current_collab_id()
        AND c.role IN ('coordinator', 'director')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.collaborators c
      WHERE c.id = current_collab_id()
        AND c.role IN ('coordinator', 'director')
    )
  );

-- service_role bypass (engine/migrations)
DROP POLICY IF EXISTS service_all_project_contingencies ON public.project_contingencies;
CREATE POLICY service_all_project_contingencies
  ON public.project_contingencies
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 3. projects.event_date  (preparação pro Sprint 24 — Runbook T-minus)
-- ----------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS event_date date;

COMMENT ON COLUMN public.projects.event_date IS
  'Data do evento (apenas para projetos category=event). Base para o runbook T-minus do Sprint 24.';
