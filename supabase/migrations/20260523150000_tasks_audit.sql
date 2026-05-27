-- Audit trigger em tasks: rastreia mudanças de status/completed_at pra
-- diagnosticar bugs como o de 23/05 (task Carol voltou de done→pending sem
-- evidência em logs). Logs apenas mudanças relevantes pra evitar explosão.

CREATE TABLE IF NOT EXISTS tasks_audit (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  db_user text NOT NULL DEFAULT current_user,
  app_name text,
  old_status text,
  new_status text,
  old_completed_at timestamptz,
  new_completed_at timestamptz,
  old_completed_by uuid,
  new_completed_by uuid,
  op text NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_audit_task_id_idx
  ON tasks_audit (task_id, changed_at DESC);

ALTER TABLE tasks_audit ENABLE ROW LEVEL SECURITY;

-- Só director e service_role leem audit
DROP POLICY IF EXISTS tasks_audit_read ON tasks_audit;
CREATE POLICY tasks_audit_read ON tasks_audit
  FOR SELECT
  USING (current_collab_role() = 'director');

CREATE OR REPLACE FUNCTION public.tasks_audit_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Loga apenas se status OU completed_at mudou (evita ruído de updated_at).
  IF (TG_OP = 'UPDATE' AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.completed_at IS DISTINCT FROM NEW.completed_at
    OR OLD.completed_by IS DISTINCT FROM NEW.completed_by
  )) OR TG_OP = 'INSERT' OR TG_OP = 'DELETE' THEN
    INSERT INTO tasks_audit (
      task_id, app_name, op,
      old_status, new_status,
      old_completed_at, new_completed_at,
      old_completed_by, new_completed_by
    ) VALUES (
      COALESCE(NEW.id, OLD.id),
      current_setting('application_name', true),
      TG_OP,
      OLD.status, NEW.status,
      OLD.completed_at, NEW.completed_at,
      OLD.completed_by, NEW.completed_by
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_tasks_audit ON tasks;
CREATE TRIGGER trg_tasks_audit
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_audit_fn();

COMMENT ON TABLE tasks_audit IS
  'Audit das mudanças relevantes em tasks (status, completed_at, completed_by). Registra app_name pra distinguir quem fez o write (TOM dispatcher vs PWA vs RPC).';
