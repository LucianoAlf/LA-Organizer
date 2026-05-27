-- Fix: la_journey_notify_status_change usava `collaborators.active` (não existe)
-- em vez de `is_active`. Resultado: qualquer UPDATE de status em
-- la_journey_conteudo_checkpoint estourava com ERROR 42703.
--
-- Bug encontrado em 23/05/2026 ao tentar publicar Foundation/canto.
-- Função recuperada via pg_get_functiondef no banco — preservada integralmente,
-- só trocado o nome da coluna.

CREATE OR REPLACE FUNCTION public.la_journey_notify_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_mentores uuid[];
  v_coords uuid[];
  v_id uuid;
BEGIN
  SELECT array_agg(collaborator_id) INTO v_mentores
  FROM la_journey_curso_mentores
  WHERE curso_id = NEW.curso_id AND programa_id = NEW.programa_id AND ativo = true;

  SELECT array_agg(id) INTO v_coords
  FROM collaborators
  WHERE role IN ('coordinator','director') AND is_active = true;

  IF NEW.status = 'em_revisao' AND OLD.status = 'rascunho' THEN
    FOREACH v_id IN ARRAY v_coords LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('enviado_revisao', v_id, NEW.id);
    END LOOP;
  ELSIF NEW.status = 'publicado' AND OLD.status = 'em_revisao' THEN
    FOREACH v_id IN ARRAY (v_mentores || v_coords) LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('publicado', v_id, NEW.id);
    END LOOP;
  ELSIF NEW.status = 'rascunho' AND OLD.status = 'em_revisao' THEN
    FOREACH v_id IN ARRAY v_mentores LOOP
      INSERT INTO la_journey_lembretes_log (tipo, destinatario_id, conteudo_id)
      VALUES ('devolvido', v_id, NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
