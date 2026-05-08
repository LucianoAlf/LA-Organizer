-- Sprint 22.32b — BUGFIX: trigger fn_calculate_eisenhower sobrescrevia
-- qualquer valor manual de eisenhower_quadrant a cada UPDATE/INSERT.
--
-- Reproduzido via Claude Browser teste live em la-organizer.vercel.app:
--   1. PWA enviava UPDATE com eisenhower_quadrant=1 (vermelho).
--   2. Postgres: UPDATE rodou (updated_at mudava) mas a coluna ficava em 3.
--   3. Causa: trigger BEFORE UPDATE chamava fn_calculate_eisenhower que SEMPRE
--      executava NEW.eisenhower_quadrant = CASE(...) END — overrided manual.
--
-- Fix: trigger so calcula quando eisenhower_quadrant IS NULL. Manual ganha.
-- Pra voltar ao auto, usuario seta NULL (botao "limpar"/desmarcar no picker).

CREATE OR REPLACE FUNCTION public.fn_calculate_eisenhower()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Sprint 22.32b — respeita manual: so auto-classifica se nao tiver valor.
  IF NEW.eisenhower_quadrant IS NOT NULL THEN
    RETURN NEW;
  END IF;

  NEW.eisenhower_quadrant = CASE
    -- Q1: Urgente + Importante
    WHEN (NEW.due_date - CURRENT_DATE <= 2 OR NEW.status = 'overdue')
         AND (NEW.project_id IS NOT NULL OR NEW.priority IN ('critical', 'high'))
    THEN 1
    -- Q2: Não urgente + Importante
    WHEN (NEW.due_date - CURRENT_DATE > 2)
         AND (NEW.project_id IS NOT NULL OR NEW.priority IN ('critical', 'high'))
    THEN 2
    -- Q3: Urgente + Não importante
    WHEN (NEW.due_date - CURRENT_DATE <= 2 OR NEW.status = 'overdue')
         AND (NEW.project_id IS NULL AND NEW.priority IN ('medium', 'low'))
    THEN 3
    -- Q4: Não urgente + Não importante
    ELSE 4
  END;
  RETURN NEW;
END;
$function$;
