-- Sprint 22.37 — Aderência Operacional de Checklists
-- Habilita liderança operacional (director + manager unit-específica) a ler
-- completions de toda equipe (manager filtrado por sua unidade).
-- Adiciona 2 RPCs de agregação para evitar N+1 queries no PWA.

-- 1. Helpers SECURITY DEFINER
CREATE OR REPLACE FUNCTION current_collab_unit()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT unit FROM collaborators WHERE id = current_collab_id();
  $$;

CREATE OR REPLACE FUNCTION current_collab_role()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT role FROM collaborators WHERE id = current_collab_id();
  $$;

-- 2. Policies SELECT pra liderança operacional
DROP POLICY IF EXISTS leadership_read_completions ON op_checklist_completions;
CREATE POLICY leadership_read_completions
  ON op_checklist_completions FOR SELECT
  USING (
    current_collab_role() = 'director'
    OR (
      current_collab_role() = 'manager'
      AND current_collab_unit() != 'all'
      AND EXISTS (
        SELECT 1 FROM collaborators c
        WHERE c.id = op_checklist_completions.collaborator_id
          AND c.unit = current_collab_unit()
      )
    )
  );

DROP POLICY IF EXISTS leadership_read_item_completions ON op_checklist_item_completions;
CREATE POLICY leadership_read_item_completions
  ON op_checklist_item_completions FOR SELECT
  USING (
    current_collab_role() = 'director'
    OR (
      current_collab_role() = 'manager'
      AND current_collab_unit() != 'all'
      AND EXISTS (
        SELECT 1 FROM op_checklist_completions c
        JOIN collaborators k ON k.id = c.collaborator_id
        WHERE c.id = op_checklist_item_completions.completion_id
          AND k.unit = current_collab_unit()
      )
    )
  );

DROP POLICY IF EXISTS leadership_read_templates ON op_checklists;
CREATE POLICY leadership_read_templates
  ON op_checklists FOR SELECT
  USING (
    current_collab_role() IN ('director', 'manager')
  );

-- 3. RPC: aderência por colaborador
CREATE OR REPLACE FUNCTION get_adherence_by_collab(
  p_start_date date,
  p_end_date date,
  p_unit_filter text DEFAULT NULL
)
RETURNS TABLE (
  collab_id uuid,
  full_name text,
  role text,
  unit text,
  function_title text,
  dispatched int,
  completed int,
  late_items int,
  escalated_count int,
  pct numeric
) LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    k.id as collab_id,
    k.full_name,
    k.role,
    k.unit,
    k.function_title,
    count(c.id)::int as dispatched,
    count(c.completed_at)::int as completed,
    coalesce((
      SELECT count(*) FROM op_checklist_item_completions ic
      JOIN op_checklist_completions cc ON cc.id = ic.completion_id
      WHERE cc.collaborator_id = k.id
        AND cc.reference_date BETWEEN p_start_date AND p_end_date
        AND ic.late = true
    ), 0)::int as late_items,
    count(c.escalated_at)::int as escalated_count,
    CASE WHEN count(c.id) = 0 THEN 0
         ELSE round(count(c.completed_at)::numeric / count(c.id) * 100, 0)
    END as pct
  FROM collaborators k
  LEFT JOIN op_checklist_completions c
    ON c.collaborator_id = k.id
    AND c.reference_date BETWEEN p_start_date AND p_end_date
  WHERE k.is_active = true
    AND (p_unit_filter IS NULL OR k.unit = p_unit_filter)
  GROUP BY k.id, k.full_name, k.role, k.unit, k.function_title
  HAVING count(c.id) > 0
  ORDER BY pct ASC, k.full_name ASC;
$$;

-- 4. RPC: aderência por template pra um colab específico
CREATE OR REPLACE FUNCTION get_adherence_by_template(
  p_collab_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  template_id uuid,
  template_name text,
  template_unit text,
  dispatched int,
  completed int,
  late_items int,
  escalated_count int,
  pct numeric
) LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    t.id as template_id,
    t.name as template_name,
    t.unit as template_unit,
    count(c.id)::int as dispatched,
    count(c.completed_at)::int as completed,
    coalesce((
      SELECT count(*) FROM op_checklist_item_completions ic
      WHERE ic.completion_id IN (
        SELECT id FROM op_checklist_completions
        WHERE collaborator_id = p_collab_id
          AND reference_date BETWEEN p_start_date AND p_end_date
          AND checklist_id = t.id
      )
        AND ic.late = true
    ), 0)::int as late_items,
    count(c.escalated_at)::int as escalated_count,
    CASE WHEN count(c.id) = 0 THEN 0
         ELSE round(count(c.completed_at)::numeric / count(c.id) * 100, 0)
    END as pct
  FROM op_checklists t
  LEFT JOIN op_checklist_completions c
    ON c.checklist_id = t.id
    AND c.collaborator_id = p_collab_id
    AND c.reference_date BETWEEN p_start_date AND p_end_date
  GROUP BY t.id, t.name, t.unit
  HAVING count(c.id) > 0
  ORDER BY pct ASC;
$$;
