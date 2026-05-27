-- LA Journey — Governança: bloqueia escrita em conteúdo publicado + previne
-- race condition na criação de marcos.
--
-- Contexto: auditoria 23/05 identificou 2 gaps:
--   (a) coordenador/mentor podia EDITAR marcos/campos de um conteúdo com
--       status='publicado' (apenas upsertJourneyConteudoHeader bloqueava no app)
--   (b) la_journey_marcos NÃO tinha UNIQUE em (conteudo_id, numero) — 2 mentores
--       criando marcos simultâneos podiam gerar duplicata silenciosa

-- ─── 1. UNIQUE(conteudo_id, numero) em la_journey_marcos ───────────────
ALTER TABLE la_journey_marcos
  ADD CONSTRAINT la_journey_marcos_conteudo_numero_uniq
  UNIQUE (conteudo_id, numero);

-- ─── 2. Reescreve can_edit_marco_campo bloqueando status='publicado' ───
CREATE OR REPLACE FUNCTION public.can_edit_marco_campo(p_marco_id uuid, p_collab_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Bloqueio universal: se o conteúdo do marco está publicado, ninguém edita
  -- (nem coord nem mentor). Direção pode despublicar (status='rascunho') antes.
  SELECT NOT EXISTS (
    SELECT 1 FROM la_journey_marcos mr
    JOIN la_journey_conteudo_checkpoint cc ON cc.id = mr.conteudo_id
    WHERE mr.id = p_marco_id AND cc.status = 'publicado'
  ) AND (
    (SELECT role FROM collaborators WHERE id = p_collab_id)
      = ANY (ARRAY['coordinator','director'])
    OR EXISTS (
      SELECT 1 FROM la_journey_marcos mr
      JOIN la_journey_conteudo_checkpoint cc ON cc.id = mr.conteudo_id
      JOIN la_journey_curso_mentores m
        ON m.curso_id = cc.curso_id AND m.programa_id = cc.programa_id
      WHERE mr.id = p_marco_id AND m.collaborator_id = p_collab_id AND m.ativo = true
    )
  );
$function$;

-- ─── 3. Atualiza la_journey_conteudo_write pra bloquear UPDATE em publicado ──
-- Mantém INSERT livre (novo conteúdo sempre nasce 'rascunho'); bloqueia UPDATE
-- quando a linha atual já está publicada — exceção: director pode despublicar.
DROP POLICY IF EXISTS la_journey_conteudo_write ON la_journey_conteudo_checkpoint;

CREATE POLICY la_journey_conteudo_write
  ON la_journey_conteudo_checkpoint
  FOR ALL
  USING (
    -- Quem pode acessar a linha (USING aplica a UPDATE/DELETE)
    (
      current_collab_role() = ANY (ARRAY['coordinator','director'])
      OR EXISTS (
        SELECT 1 FROM la_journey_curso_mentores m
        WHERE m.curso_id = la_journey_conteudo_checkpoint.curso_id
          AND m.programa_id = la_journey_conteudo_checkpoint.programa_id
          AND m.collaborator_id = current_collab_id()
          AND m.ativo = true
      )
    )
    -- ...desde que o conteúdo NÃO esteja publicado, OU o user seja director
    AND (
      status <> 'publicado'
      OR current_collab_role() = 'director'
    )
  )
  WITH CHECK (
    -- Mesma regra na escrita: só permite INSERT/UPDATE se mentor/coord, e o
    -- estado pós-mudança não seja publicado (exceto director).
    (
      current_collab_role() = ANY (ARRAY['coordinator','director'])
      OR EXISTS (
        SELECT 1 FROM la_journey_curso_mentores m
        WHERE m.curso_id = la_journey_conteudo_checkpoint.curso_id
          AND m.programa_id = la_journey_conteudo_checkpoint.programa_id
          AND m.collaborator_id = current_collab_id()
          AND m.ativo = true
      )
    )
    AND (
      status <> 'publicado'
      OR current_collab_role() = 'director'
    )
  );

-- ─── 4. Comentários documentação ─────────────────────────────────────────
COMMENT ON CONSTRAINT la_journey_marcos_conteudo_numero_uniq ON la_journey_marcos
  IS 'Previne race condition: 2 mentores criando marco no mesmo tick não geram numero duplicado.';

COMMENT ON FUNCTION public.can_edit_marco_campo(uuid, uuid)
  IS 'Decide se collab pode editar marco. Bloqueia universalmente se conteudo.status=publicado.';
