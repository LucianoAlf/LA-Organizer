-- Histórico de aportes de metas + trigger que mantém pf_goals.current_amount.
-- Ordem importa: backfill ANTES do trigger (senão duplicaria o saldo existente).

-- 1) Tabela de aportes (log)
CREATE TABLE IF NOT EXISTS pf_goal_contributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  goal_id         uuid NOT NULL REFERENCES pf_goals(id) ON DELETE CASCADE,
  amount          numeric NOT NULL CHECK (amount > 0),
  note            text,
  contributed_at  date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pf_goal_contrib_goal   ON pf_goal_contributions(goal_id);
CREATE INDEX IF NOT EXISTS idx_pf_goal_contrib_collab ON pf_goal_contributions(collaborator_id);

-- 2) Backfill: 1 aporte "saldo inicial" por meta com saldo > 0 (ANTES do trigger)
INSERT INTO pf_goal_contributions (collaborator_id, goal_id, amount, note, contributed_at, created_at)
SELECT collaborator_id, id, current_amount, 'saldo inicial', created_at::date, created_at
FROM pf_goals WHERE current_amount > 0;

-- 3) Trigger que mantém pf_goals.current_amount (espelha pf_sync_account_balance)
CREATE OR REPLACE FUNCTION pf_sync_goal_amount() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE pf_goals SET current_amount = current_amount + NEW.amount, updated_at = now() WHERE id = NEW.goal_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE pf_goals SET current_amount = GREATEST(current_amount - OLD.amount, 0), updated_at = now() WHERE id = OLD.goal_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE pf_goals SET current_amount = current_amount - OLD.amount + NEW.amount, updated_at = now() WHERE id = NEW.goal_id;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pf_sync_goal_amount ON pf_goal_contributions;
CREATE TRIGGER trg_pf_sync_goal_amount
  AFTER INSERT OR UPDATE OR DELETE ON pf_goal_contributions
  FOR EACH ROW EXECUTE FUNCTION pf_sync_goal_amount();

-- 4) RLS (espelha pf_goals_owner)
ALTER TABLE pf_goal_contributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pf_goal_contributions_owner ON pf_goal_contributions;
CREATE POLICY pf_goal_contributions_owner ON pf_goal_contributions FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
